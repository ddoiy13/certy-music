// GitHub Releases 업데이트 상태 관리. electron-updater의 autoUpdater를 주입받아 쓰므로
// Electron 없이도 테스트할 수 있다. autoUpdater가 null이면(개발 실행) 아무것도 확인하지 않는다.
const semver = require('semver');

const DEV_MESSAGE = '개발 실행에서는 업데이트를 확인하지 않습니다.';
const FALLBACK_ERROR = '업데이트 중 오류가 발생했습니다.';
const PRERELEASE_VERSION = /^\d+\.\d+\.\d+-/;
const CLEARED = { status: 'idle', version: null, percent: 0, error: null, downgrade: false };

function messageOf(err) {
  const first = err && err.message ? String(err.message).split('\n')[0].trim() : '';
  return (first || FALLBACK_ERROR).slice(0, 200);
}

// 같은 버전은 한 번만 알린다. 다운그레이드는 사용자가 직접 고른 채널 전환의 결과라 알리지 않는다.
function shouldNotify(state, notifiedVersion) {
  return !!state.version
    && !state.downgrade
    && state.version !== notifiedVersion
    && ['available', 'downloading', 'ready'].includes(state.status);
}

function createUpdater({ autoUpdater, currentVersion = '', onState = () => {} } = {}) {
  let state = { ...CLEARED };
  let auto = false;
  let quiet = false; // 백그라운드 확인 중이면 오류를 화면에 올리지 않는다
  let installRequested = false; // [업데이트 설치]를 눌렀으면 다 받자마자 설치한다

  function set(patch) {
    const next = { ...state, ...patch };
    if (['status', 'version', 'percent', 'error', 'downgrade'].every((k) => next[k] === state[k])) return;
    state = next;
    onState({ ...state });
  }

  function fail(err) {
    installRequested = false;
    if (quiet) set({ ...CLEARED });
    else set({ status: 'error', error: messageOf(err) });
  }

  function isDowngrade(version) {
    return !!semver.valid(version) && !!semver.valid(currentVersion) && semver.lt(version, currentVersion);
  }

  function download() {
    return autoUpdater.downloadUpdate().catch(fail);
  }

  if (autoUpdater) {
    // autoDownload는 항상 false다. 켜 두면 electron-updater가 다운그레이드까지 바로 내려받는다.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    // autoUpdater.channel은 건드리지 않는다. 설정하면 allowDowngrade가 자동으로 true가 되고,
    // allowPrerelease일 때 프리릴리스 릴리스를 고르는 로직(GitHubProvider)도 막힌다.

    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => {
      const downgrade = isDowngrade(info.version);
      // 자동 모드는 업그레이드만 알아서 내려받는다. 다운그레이드는 항상 사용자가 직접 설치한다.
      if (auto && !downgrade) {
        quiet = true;
        set({ status: 'downloading', version: info.version, percent: 0, error: null, downgrade: false });
        download();
      } else {
        set({ status: 'available', version: info.version, percent: 0, error: null, downgrade });
      }
    });
    autoUpdater.on('update-not-available', () => set({ ...CLEARED, status: 'uptodate' }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => {
      set({ status: 'ready', version: info.version, percent: 100, error: null });
      if (installRequested) {
        installRequested = false;
        autoUpdater.quitAndInstall(true, true);
      }
    });
    autoUpdater.on('error', fail);
  }

  return {
    async check({ manual = false } = {}) {
      if (!autoUpdater) {
        if (manual) set({ status: 'error', error: DEV_MESSAGE });
        return;
      }
      if (['checking', 'downloading', 'ready'].includes(state.status)) return;
      quiet = !manual;
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        fail(err);
        return;
      }
      if (state.status === 'checking') set({ status: 'idle' });
    },

    async install() {
      if (!autoUpdater) return;
      if (state.status === 'ready') {
        autoUpdater.quitAndInstall(true, true);
        return;
      }
      if (state.status !== 'available') return;
      quiet = false;
      installRequested = true;
      set({ status: 'downloading', percent: 0, error: null });
      await download();
    },

    setAutoUpdate(on) {
      auto = !!on;
      if (!autoUpdater) return;
      autoUpdater.autoInstallOnAppQuit = auto;
      // 이미 발견된 업그레이드만 바로 내려받는다. 다운그레이드는 수동 설치를 기다린다.
      if (auto && state.status === 'available' && !state.downgrade) {
        quiet = true;
        set({ status: 'downloading', percent: 0, error: null });
        download();
      }
    },

    // 채널은 프리릴리스 포함 여부일 뿐이다. 이미 받은(ready) 업데이트는 그대로 둔다.
    setChannel(channel) {
      const pre = channel === 'prerelease';
      if (autoUpdater) {
        autoUpdater.allowPrerelease = pre;
        autoUpdater.allowDowngrade = !pre && PRERELEASE_VERSION.test(currentVersion);
      }
      if (state.status === 'available') set({ ...CLEARED });
    },

    getState() {
      return { ...state };
    },
  };
}

module.exports = { DEV_MESSAGE, createUpdater, shouldNotify };
