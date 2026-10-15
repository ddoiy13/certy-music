const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, shouldNotify, DEV_MESSAGE } = require('../src/updater');

class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.onCheck = async () => {};
    this.onDownload = async () => {};
  }
  async checkForUpdates() {
    this.calls.push('check');
    return this.onCheck();
  }
  async downloadUpdate() {
    this.calls.push('download');
    return this.onDownload();
  }
  quitAndInstall(...args) {
    this.calls.push(['quitAndInstall', ...args]);
  }
}

function setup(currentVersion = '1.1.0') {
  const au = new FakeAutoUpdater();
  const states = [];
  const u = createUpdater({ autoUpdater: au, currentVersion, onState: (s) => states.push(s) });
  return { au, u, states };
}

// 확인하면 새 버전 v1.2.0을 발견하는 가짜 서버
function findsUpdate(au, version = '1.2.0') {
  au.onCheck = async () => {
    au.emit('checking-for-update');
    au.emit('update-available', { version });
  };
}

test('기본 설정: 자동 다운로드/종료 시 설치 꺼짐, 프리릴리스 꺼짐', () => {
  const { au } = setup();
  assert.equal(au.autoDownload, false);
  assert.equal(au.autoInstallOnAppQuit, false);
  assert.equal(au.allowPrerelease, false);
  assert.equal(au.allowDowngrade, false);
  // channel을 설정하면 electron-updater가 allowDowngrade를 켜고 프리릴리스 선택도 막는다.
  assert.equal(au.channel, undefined);
});

test('개발 실행(autoUpdater 없음)은 수동 확인에만 안내 오류를 낸다', async () => {
  const states = [];
  const u = createUpdater({ autoUpdater: null, currentVersion: '1.0.0', onState: (s) => states.push(s) });
  await u.check({ manual: false });
  assert.equal(states.length, 0);
  await u.check({ manual: true });
  assert.equal(u.getState().status, 'error');
  assert.equal(u.getState().error, DEV_MESSAGE);
});

test('새 버전을 발견하면 checking → available', async () => {
  const { au, u, states } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  assert.deepEqual(states.map((s) => s.status), ['checking', 'available']);
  assert.equal(u.getState().version, '1.2.0');
});

test('최신이면 uptodate', async () => {
  const { au, u } = setup();
  au.onCheck = async () => {
    au.emit('checking-for-update');
    au.emit('update-not-available', { version: '1.1.0' });
  };
  await u.check({ manual: true });
  assert.equal(u.getState().status, 'uptodate');
  assert.equal(u.getState().version, null);
});

test('install: 내려받고 진행률을 반영한 뒤, 다 받으면 조용히 설치하고 재실행한다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  await u.install();
  assert.ok(au.calls.includes('download'));
  assert.equal(u.getState().status, 'downloading');
  au.emit('download-progress', { percent: 40.4 });
  assert.equal(u.getState().percent, 40);
  au.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(u.getState().status, 'ready');
  assert.deepEqual(au.calls.at(-1), ['quitAndInstall', true, true]);
});

test('ready 상태에서 install하면 바로 설치한다', async () => {
  const { au, u } = setup();
  au.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(u.getState().status, 'ready');
  await u.install();
  assert.deepEqual(au.calls.at(-1), ['quitAndInstall', true, true]);
});

test('자동 모드: 발견 즉시 내려받고 종료 시 설치가 켜진다', async () => {
  const { au, u } = setup();
  u.setAutoUpdate(true);
  // autoDownload는 항상 false다. 다운그레이드를 거르려고 updater가 직접 내려받는다.
  assert.equal(au.autoDownload, false);
  assert.equal(au.autoInstallOnAppQuit, true);
  findsUpdate(au);
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'downloading');
  assert.equal(u.getState().version, '1.2.0');
  assert.equal(u.getState().downgrade, false);
  assert.ok(au.calls.includes('download'));
  // 자동 모드에서는 다 받아도 즉시 재시작하지 않는다 (종료 시 설치).
  au.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(u.getState().status, 'ready');
  assert.equal(au.calls.some((c) => Array.isArray(c) && c[0] === 'quitAndInstall'), false);
});

test('자동 모드여도 다운그레이드는 내려받지 않고 available로 기다린다', async () => {
  const { au, u } = setup('1.2.0-beta.1');
  u.setChannel('stable');
  u.setAutoUpdate(true);
  findsUpdate(au, '1.1.0');
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'available');
  assert.equal(u.getState().version, '1.1.0');
  assert.equal(u.getState().downgrade, true);
  assert.equal(au.calls.includes('download'), false);
});

test('자동 모드를 켜도 이미 발견된 다운그레이드는 내려받지 않는다', async () => {
  const { au, u } = setup('1.2.0-beta.1');
  u.setChannel('stable');
  findsUpdate(au, '1.1.0');
  await u.check({ manual: true });
  u.setAutoUpdate(true);
  assert.equal(u.getState().status, 'available');
  assert.equal(au.calls.includes('download'), false);
});

test('다운그레이드는 사용자가 install()을 호출해야 내려받고 설치한다', async () => {
  const { au, u } = setup('1.2.0-beta.1');
  u.setChannel('stable');
  findsUpdate(au, '1.1.0');
  await u.check({ manual: true });
  await u.install();
  assert.ok(au.calls.includes('download'));
  au.emit('update-downloaded', { version: '1.1.0' });
  assert.deepEqual(au.calls.at(-1), ['quitAndInstall', true, true]);
});

test('같은 버전 계열의 업그레이드는 downgrade가 아니다', async () => {
  const { au, u } = setup('1.2.0-beta.1');
  findsUpdate(au, '1.2.0');
  await u.check({ manual: true });
  assert.equal(u.getState().downgrade, false);
});

test('자동 모드를 켜면 이미 발견된 업데이트를 바로 내려받는다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  u.setAutoUpdate(true);
  assert.ok(au.calls.includes('download'));
  assert.equal(u.getState().status, 'downloading');
});

test('백그라운드 확인 실패는 조용히 idle로 돌아간다 (오프라인)', async () => {
  const { au, u } = setup();
  au.onCheck = async () => {
    const err = new Error('net::ERR_INTERNET_DISCONNECTED');
    au.emit('error', err);
    throw err;
  };
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'idle');
  assert.equal(u.getState().error, null);
});

test('수동 확인 실패는 error와 사유를 표시한다', async () => {
  const { au, u } = setup();
  au.onCheck = async () => {
    throw new Error('net::ERR_INTERNET_DISCONNECTED\nstack…');
  };
  await u.check({ manual: true });
  assert.equal(u.getState().status, 'error');
  assert.equal(u.getState().error, 'net::ERR_INTERNET_DISCONNECTED');
});

test('다운로드 중에는 수동 확인과 채널 변경이 진행을 끊지 않는다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  await u.install();
  au.calls.length = 0;
  await u.check({ manual: true });
  assert.equal(au.calls.includes('check'), false);
  u.setChannel('prerelease');
  assert.equal(u.getState().status, 'downloading');
});

test('설치(다운로드) 실패 후에도 다시 확인할 수 있다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  au.onDownload = async () => {
    throw new Error('download failed');
  };
  await u.install();
  assert.equal(u.getState().status, 'error');
  assert.equal(u.getState().error, 'download failed');
  au.calls.length = 0;
  await u.check({ manual: true });
  assert.ok(au.calls.includes('check'));
  assert.equal(u.getState().status, 'available');
});

test('setChannel: prerelease는 allowPrerelease, stable은 프리릴리스 설치본일 때만 다운그레이드 허용', () => {
  const a = setup('1.1.0');
  a.u.setChannel('prerelease');
  assert.equal(a.au.allowPrerelease, true);
  assert.equal(a.au.allowDowngrade, false);
  a.u.setChannel('stable');
  assert.equal(a.au.allowPrerelease, false);
  assert.equal(a.au.allowDowngrade, false);

  const b = setup('1.2.0-beta.1');
  b.u.setChannel('stable');
  assert.equal(b.au.allowPrerelease, false);
  assert.equal(b.au.allowDowngrade, true);
  b.u.setChannel('prerelease');
  assert.equal(b.au.allowDowngrade, false);
});

test('setChannel: 발견만 된 업데이트는 비우고, 이미 받은(ready) 업데이트는 유지한다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  u.setChannel('prerelease');
  assert.equal(u.getState().status, 'idle');
  assert.equal(u.getState().version, null);

  au.emit('update-downloaded', { version: '1.3.0-beta.1' });
  u.setChannel('stable');
  assert.equal(u.getState().status, 'ready');
  assert.equal(u.getState().version, '1.3.0-beta.1');
});

test('shouldNotify: 같은 버전은 한 번만, 버전이 없거나 idle/uptodate/error는 알리지 않는다', () => {
  const st = (status, version, downgrade = false) => ({ status, version, percent: 0, error: null, downgrade });
  assert.equal(shouldNotify(st('available', '1.1.0', true), null), false); // 다운그레이드는 알리지 않는다
  assert.equal(shouldNotify(st('available', '1.2.0'), null), true);
  assert.equal(shouldNotify(st('downloading', '1.2.0'), null), true);
  assert.equal(shouldNotify(st('available', '1.2.0'), '1.2.0'), false);
  assert.equal(shouldNotify(st('available', '1.3.0'), '1.2.0'), true);
  for (const status of ['idle', 'checking', 'uptodate', 'error']) {
    assert.equal(shouldNotify(st(status, '1.2.0'), null), false, status);
  }
  assert.equal(shouldNotify(st('available', null), null), false);
});

test('확인 중에 채널을 바꾸면 그 확인이 끝난 뒤 한 번 더 확인한다', async () => {
  const { au, u } = setup();
  let release;
  let n = 0;
  au.onCheck = () => {
    n++;
    return new Promise((r) => { release = r; });
  };
  const first = u.check({ manual: false });
  au.emit('checking-for-update');
  u.setChannel('prerelease');
  await u.check({ manual: true });
  assert.equal(n, 1);
  au.onCheck = async () => {
    n++;
    au.emit('checking-for-update');
    au.emit('update-not-available', { version: '1.1.0' });
  };
  release();
  await first;
  assert.equal(n, 2);
  assert.equal(u.getState().status, 'uptodate');
});

test('백그라운드 확인 중에 누른 수동 확인이 실패하면 오류를 표시한다', async () => {
  const { au, u } = setup();
  let reject;
  au.onCheck = () => new Promise((_, rej) => { reject = rej; });
  const first = u.check({ manual: false });
  au.emit('checking-for-update');
  await u.check({ manual: true });
  au.onCheck = async () => {
    throw new Error('offline');
  };
  reject(new Error('offline'));
  await first;
  assert.equal(u.getState().status, 'error');
  assert.equal(u.getState().error, 'offline');
});

test('백그라운드 확인이 실패해도 이미 발견된 업데이트 표시는 유지한다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  assert.equal(u.getState().status, 'available');
  au.onCheck = async () => {
    const err = new Error('net::ERR_INTERNET_DISCONNECTED');
    au.emit('error', err);
    throw err;
  };
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'available');
  assert.equal(u.getState().version, '1.2.0');
  assert.equal(u.getState().error, null);
});

test('채널을 바꾼 뒤에는 이전 채널에서 발견한 업데이트가 실패 복구로 되살아나지 않는다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  u.setChannel('prerelease');
  au.onCheck = async () => {
    const err = new Error('offline');
    au.emit('error', err);
    throw err;
  };
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'idle');
  assert.equal(u.getState().version, null);
});

test('최신으로 확인된 뒤의 백그라운드 실패는 예전에 발견한 업데이트를 되살리지 않는다', async () => {
  const { au, u } = setup();
  findsUpdate(au);
  await u.check({ manual: true });
  au.onCheck = async () => {
    au.emit('checking-for-update');
    au.emit('update-not-available', { version: '1.1.0' });
  };
  await u.check({ manual: true });
  assert.equal(u.getState().status, 'uptodate');
  au.onCheck = async () => {
    const err = new Error('offline');
    au.emit('error', err);
    throw err;
  };
  await u.check({ manual: false });
  assert.equal(u.getState().status, 'idle');
  assert.equal(u.getState().version, null);
});
