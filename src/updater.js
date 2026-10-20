// GitHub Releases 업데이트 상태 관리. electron-updater의 autoUpdater를 주입받아 쓰므로
// Electron 없이도 테스트할 수 있다. autoUpdater가 null이면(개발 실행) 아무것도 확인하지 않는다.
const semver = require('semver');

// 번역 키다. 화면에는 설정 탭이 현재 언어로 바꿔 보여 준다 (electron이 준 원문 메시지는 그대로 표시).
const DEV_MESSAGE = 'update.devMessage';
const FALLBACK_ERROR = 'update.fallbackError';
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
  let pending = null; // 확인 중에 들어온 확인 요청. 끝난 뒤 한 번 더 확인한다 (예: 확인 중 채널 변경)
  let found = null; // 마지막으로 발견한 'available' 상태. 백그라운드 실패 때 되살린다

  function set(patch) {
    const next = { ...state, ...patch };
    if (['status', 'version', 'percent', 'error', 'downgrade'].every((k) => next[k] === state[k])) return;
    state = next;
    if (state.status === 'available') found = { ...state };
    else if (['uptodate', 'downloading', 'ready'].includes(state.status)) found = null;
    onState({ ...state });
  }

  function fail(err) {
    installRequested = false;
    // 백그라운드 실패로 이미 보여 준 업데이트 제안을 지우지 않는다.
    if (quiet) set(found ? { ...found } : { ...CLEARED });
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

  async function check({ manual = false } = {}) {
    if (!autoUpdater) {
      if (manual) set({ status: 'error', error: DEV_MESSAGE });
      return;
    }
    // 사용자가 직접 누른 확인은 진행 중인 확인이 백그라운드였어도 실패를 보여 준다.
    if (manual) quiet = false;
    if (state.status === 'checking') {
      pending = { manual: manual || !!(pending && pending.manual) };
      return;
    }
    if (['downloading', 'ready'].includes(state.status)) return;
    quiet = !manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      fail(err);
    }
    if (state.status === 'checking') set({ status: 'idle' });
    if (pending) {
      const next = pending;
      pending = null;
      await check(next);
    }
  }

  return {
    check,

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
      found = null;
      if (state.status === 'available') set({ ...CLEARED });
    },

    getState() {
      return { ...state };
    },
  };
}

module.exports = { DEV_MESSAGE, createUpdater, shouldNotify };
