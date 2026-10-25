const { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen, session, shell } = require('electron');
const path = require('node:path');
const settingsStore = require('./settings');
const { createShortcutManager, MEDIA_KEYS } = require('./shortcuts');
const player = require('./player');
const betterLyrics = require('./extension');
const { createPresence } = require('./presence');
const { createUpdater, shouldNotify } = require('./updater');
const i18n = require('./i18n');

const START_URL = 'https://music.youtube.com/';
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=' + encodeURIComponent('https://music.youtube.com/'));
const PARTITION = 'persist:ytmusic';
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/];

// Dev runs must not touch the packaged app's (cookie-encrypted) userData folder:
// with the cookieEncryption fuse enabled, an unfused electron binary would corrupt that store.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'yt-music-electron-dev'));

if (process.env.YTM_DEBUG_PORT && !app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.YTM_DEBUG_PORT);
}

let win = null;
let loginRedirected = false;
let settings = null;
let shortcuts = null;
let blExt = null;
let presence = null;
let presenceTimer = null;
const PRESENCE_POLL_MS = 3000;
let updater = null;
let updateFirstTimer = null;
let updateTimer = null;
let notifiedVersion = null;
const UPDATE_FIRST_CHECK_MS = 10 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// 설정이 auto면 OS 언어를 따른다. 감지에 실패하면 영어다.
function currentLocale() {
  return i18n.resolveLocale(settings.language, systemLocale());
}

// 설정을 'auto'로 두면 적용될 언어. 설정 탭의 "자동 (한국어)" 표시에 쓴다.
function autoLocale() {
  return i18n.resolveLocale('auto', systemLocale());
}

function systemLocale() {
  try {
    return app.getLocale();
  } catch {
    return '';
  }
}

function i18nState() {
  const locale = currentLocale();
  return { language: settings.language, locale, strings: i18n.strings(locale) };
}

function isAllowedUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

function openExternalSafe(url) {
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url);
  } catch {}
}

// Every web contents (main window, popups, Better Lyrics options window) gets the same guards.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'devtools') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow' };
    openExternalSafe(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return;
    try {
      // The extension options page may navigate within its own chrome-extension:// origin.
      if (new URL(url).protocol === 'chrome-extension:' && contents.getURL().startsWith('chrome-extension://')) return;
    } catch {}
    event.preventDefault();
    openExternalSafe(url);
  });
});

// 저장된 위치가 연결 해제된 모니터 밖이면 x, y를 버려 OS가 기본 위치에 놓게 한다.
function visibleBounds(w) {
  if (w.x === undefined) return w;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return w.x < a.x + a.width - 50 && w.x + w.width > a.x + 50 && w.y >= a.y - 10 && w.y < a.y + a.height - 50;
  });
  if (onScreen) return w;
  const { x, y, ...rest } = w;
  return rest;
}

function createWindow() {
  const b = visibleBounds(settings.window);
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (b.maximized) win.maximize();

  win.on('close', () => {
    try {
      const n = win.getNormalBounds();
      settings.window = { width: n.width, height: n.height, x: n.x, y: n.y, maximized: win.isMaximized() };
      settingsStore.save(settingsFile(), settings);
    } catch (err) {
      console.error('Failed to save window state:', err);
    }
  });
  // window.open / will-navigate guards are installed globally in 'web-contents-created'.
  // Logged-out visits to music.youtube.com get redirected to a promo page (/premium, /musicpremium).
  // Send the user to Google login instead. One-shot so a logged-in account that is also
  // redirected (e.g. restricted region) cannot cause an infinite loop.
  win.webContents.on('will-redirect', (event, url) => {
    if (loginRedirected) return;
    try {
      const { hostname, pathname } = new URL(url);
      const isYt = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
      if (isYt && (pathname === '/premium' || pathname === '/musicpremium')) {
        event.preventDefault();
        loginRedirected = true;
        win.webContents.loadURL(LOGIN_URL);
      }
    } catch {}
  });
  win.loadURL(START_URL);
}

function controlPlayer(action) {
  if (win && !win.isDestroyed()) player.control(win.webContents, action);
}

// 곡 정보를 주기적으로 읽어 Discord 활동으로 반영한다. 같은 상태면 presence가 다시 보내지 않는다.
function startPresence() {
  presence = createPresence();
  presence.setEnabled(settings.discord);
  presenceTimer = setInterval(async () => {
    if (!settings.discord || !win || win.isDestroyed()) return;
    presence.update(await player.readTrack(win.webContents));
  }, PRESENCE_POLL_MS);
}

// 새 버전을 확인하고 상태를 설정 탭에 푸시한다. 새 버전은 버전마다 한 번만 알림으로 알린다.
function startUpdater() {
  updater = createUpdater({
    autoUpdater: app.isPackaged ? require('electron-updater').autoUpdater : null,
    currentVersion: app.getVersion(),
    onState: (state) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
      if (shouldNotify(state, notifiedVersion)) {
        notifiedVersion = state.version;
        try {
          new Notification({ title: 'Certy Music', body: i18n.createTranslator(currentLocale())('update.notify', { version: state.version }) }).show();
        } catch (err) {
          console.error('Failed to show the update notification:', err);
        }
      }
    },
  });
  updater.setChannel(settings.updateChannel);
  updater.setAutoUpdate(settings.autoUpdate);
  updateFirstTimer = setTimeout(() => updater.check({ manual: false }), UPDATE_FIRST_CHECK_MS);
  updateTimer = setInterval(() => updater.check({ manual: false }), UPDATE_INTERVAL_MS);
}

const handlers = {
  playPause: () => controlPlayer('playPause'),
  next: () => controlPlayer('next'),
  prev: () => controlPlayer('prev'),
};

// IPC는 music.youtube.com 프레임에서 온 것만 받는다.
function trusted(event) {
  try {
    const frame = event.senderFrame;
    if (!frame || !event.sender || frame !== event.sender.mainFrame) return false;
    const u = new URL(frame.url);
    return u.protocol === 'https:' && u.hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}

function applyShortcut(action, accelerator) {
  if (!settingsStore.ACTIONS.includes(action)) return { ok: false, reason: 'error.invalidRequest' };
  const others = settingsStore.ACTIONS.filter((a) => a !== action).map((a) => settings.shortcuts[a]);
  const v = settingsStore.validateAccelerator(accelerator, others);
  if (!v.ok) return v;
  if (!shortcuts.change(action, v.accelerator)) {
    return { ok: false, reason: 'error.shortcutUnavailable' };
  }
  const previous = settings.shortcuts[action];
  settings.shortcuts[action] = v.accelerator;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Failed to save the shortcut setting:', err);
    try { shortcuts.change(action, previous); } catch (e2) { console.error(e2); }
    settings.shortcuts[action] = previous;
    return { ok: false, reason: 'error.saveFailed' };
  }
  return { ok: true, shortcuts: { ...settings.shortcuts } };
}

ipcMain.handle('settings:get', (event) => {
  if (!trusted(event)) return null;
  return {
    shortcuts: { ...settings.shortcuts },
    mediaKeys: MEDIA_KEYS,
    betterLyrics: !!blExt,
    discord: settings.discord,
    version: app.getVersion(),
    autoUpdate: settings.autoUpdate,
    updateChannel: settings.updateChannel,
    language: settings.language,
    autoLocale: autoLocale(),
    update: updater ? updater.getState() : null,
  };
});
ipcMain.handle('i18n:get', (event) => (trusted(event) ? i18nState() : null));
ipcMain.handle('settings:setLanguage', (event, language) => {
  if (!trusted(event) || !settingsStore.LANGUAGES.includes(language)) return { ok: false, reason: 'error.notAllowed' };
  const previous = settings.language;
  settings.language = language;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Failed to save the language setting:', err);
    settings.language = previous;
    return { ok: false, reason: 'error.saveFailed' };
  }
  return { ok: true, ...i18nState() };
});
ipcMain.handle('settings:setDiscord', (event, on) => {
  if (!trusted(event) || typeof on !== 'boolean') return { ok: false, reason: 'error.notAllowed' };
  const previous = settings.discord;
  settings.discord = on;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Failed to save the Discord setting:', err);
    settings.discord = previous;
    return { ok: false, reason: 'error.saveFailed' };
  }
  if (presence) presence.setEnabled(on);
  return { ok: true, discord: on };
});
ipcMain.handle('settings:setAutoUpdate', (event, on) => {
  if (!trusted(event) || typeof on !== 'boolean') return { ok: false, reason: 'error.notAllowed' };
  const previous = settings.autoUpdate;
  settings.autoUpdate = on;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Failed to save the auto-update setting:', err);
    settings.autoUpdate = previous;
    return { ok: false, reason: 'error.saveFailed' };
  }
  if (updater) updater.setAutoUpdate(on);
  return { ok: true, autoUpdate: on };
});
ipcMain.handle('settings:setUpdateChannel', (event, channel) => {
  if (!trusted(event) || !settingsStore.CHANNELS.includes(channel)) {
    return { ok: false, reason: 'error.notAllowed' };
  }
  const previous = settings.updateChannel;
  settings.updateChannel = channel;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Failed to save the update channel setting:', err);
    settings.updateChannel = previous;
    return { ok: false, reason: 'error.saveFailed' };
  }
  if (updater) {
    updater.setChannel(channel);
    updater.check({ manual: true });
  }
  return { ok: true, updateChannel: channel };
});
ipcMain.handle('update:check', (event) => {
  if (!trusted(event) || !updater) return { ok: false };
  updater.check({ manual: true });
  return { ok: true };
});
ipcMain.handle('update:install', (event) => {
  if (!trusted(event) || !updater) return { ok: false };
  updater.install();
  return { ok: true };
});
ipcMain.handle('settings:setShortcut', (event, action, accelerator) =>
  trusted(event) ? applyShortcut(action, accelerator) : { ok: false, reason: 'error.notAllowed' },
);
ipcMain.handle('settings:resetShortcut', (event, action) =>
  trusted(event) ? applyShortcut(action, settingsStore.DEFAULT_SHORTCUTS[action]) : { ok: false, reason: 'error.notAllowed' },
);
ipcMain.handle('bl:openOptions', (event) => {
  if (!trusted(event) || !blExt) return { ok: false };
  betterLyrics.openOptions(session.fromPartition(PARTITION), blExt);
  return { ok: true };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    const ses = session.fromPartition(PARTITION);
    blExt = await betterLyrics.load(ses);
    settings = settingsStore.load(settingsFile());
    createWindow();
    shortcuts = createShortcutManager(globalShortcut, handlers);
    const failed = shortcuts.applyAll(settings.shortcuts);
    if (failed.length) console.warn('Failed to register shortcuts:', failed.join(', '));
    startPresence();
    startUpdater();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(presenceTimer);
    clearTimeout(updateFirstTimer);
    clearInterval(updateTimer);
    if (presence) presence.destroy();
  });
}
