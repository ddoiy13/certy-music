const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const settingsStore = require('./settings');
const { createShortcutManager, MEDIA_KEYS } = require('./shortcuts');
const player = require('./player');
const betterLyrics = require('./extension');
const { createPresence } = require('./presence');

const START_URL = 'https://music.youtube.com/';
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=' + encodeURIComponent('https://music.youtube.com/'));
const PARTITION = 'persist:ytmusic';
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/];

app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
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

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

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
      console.error('창 상태를 저장하지 못했습니다:', err);
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
  if (!settingsStore.ACTIONS.includes(action)) return { ok: false, reason: '잘못된 요청입니다.' };
  const others = settingsStore.ACTIONS.filter((a) => a !== action).map((a) => settings.shortcuts[a]);
  const v = settingsStore.validateAccelerator(accelerator, others);
  if (!v.ok) return v;
  if (!shortcuts.change(action, v.accelerator)) {
    return { ok: false, reason: '이 조합은 다른 프로그램이 사용 중이거나 등록할 수 없습니다.' };
  }
  const previous = settings.shortcuts[action];
  settings.shortcuts[action] = v.accelerator;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('단축키 설정을 저장하지 못했습니다:', err);
    try { shortcuts.change(action, previous); } catch (e2) { console.error(e2); }
    settings.shortcuts[action] = previous;
    return { ok: false, reason: '설정을 저장하지 못했습니다.' };
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
  };
});
ipcMain.handle('settings:setDiscord', (event, on) => {
  if (!trusted(event) || typeof on !== 'boolean') return { ok: false, reason: '허용되지 않은 요청입니다.' };
  const previous = settings.discord;
  settings.discord = on;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('Discord 설정을 저장하지 못했습니다:', err);
    settings.discord = previous;
    return { ok: false, reason: '설정을 저장하지 못했습니다.' };
  }
  if (presence) presence.setEnabled(on);
  return { ok: true, discord: on };
});
ipcMain.handle('settings:setShortcut', (event, action, accelerator) =>
  trusted(event) ? applyShortcut(action, accelerator) : { ok: false, reason: '허용되지 않은 요청입니다.' },
);
ipcMain.handle('settings:resetShortcut', (event, action) =>
  trusted(event) ? applyShortcut(action, settingsStore.DEFAULT_SHORTCUTS[action]) : { ok: false, reason: '허용되지 않은 요청입니다.' },
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
    if (failed.length) console.warn('등록 실패한 단축키:', failed.join(', '));
    startPresence();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(presenceTimer);
    if (presence) presence.destroy();
  });
}
