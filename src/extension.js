const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let optionsWindow = null;

function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extensions', 'better-lyrics')
    : path.join(__dirname, '..', 'extensions', 'better-lyrics');
}

async function load(ses) {
  const dir = extensionDir();
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.warn('Better Lyrics를 찾을 수 없음:', dir);
    return null;
  }
  try {
    return await (ses.extensions ?? ses).loadExtension(dir);
  } catch (err) {
    console.error('Better Lyrics 로드 실패:', err);
    return null;
  }
}

function openOptions(ses, ext) {
  if (optionsWindow && !optionsWindow.isDestroyed()) {
    optionsWindow.focus();
    return optionsWindow;
  }
  optionsWindow = new BrowserWindow({
    width: 900,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  optionsWindow.loadURL(`chrome-extension://${ext.id}/options/index.html`);
  return optionsWindow;
}

module.exports = { load, openOptions };
