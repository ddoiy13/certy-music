# GitHub 릴리스 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ddoiy13/certy-music`의 GitHub Releases에서 새 버전을 확인해 알림을 띄우고, 앱 설정 탭의 버튼 또는 자동 업데이트 설정으로 설치하며, Stable / Pre-Release 채널을 고를 수 있게 한다.

**Architecture:** 상태 관리는 `electron-updater`의 `autoUpdater`를 주입받는 순수 모듈 `src/updater.js`가 맡는다 (`presence.js`와 같은 방식). `main.js`는 IPC, 알림, 확인 타이머, 상태 푸시만 연결하고, `preload.js`는 앱 설정 패널에 "업데이트" 섹션을 그린다.

**Tech Stack:** Electron 44, `electron-updater`, `node:test`, 기존 `settings.js` JSON 저장소.

**Spec:** `docs/superpowers/specs/2026-10-15-auto-update-design.md`

## Global Constraints

- 사용자에게 보이는 문구는 한국어로 쓴다.
- `innerHTML`을 쓰지 않는다. `preload.js`는 `createElement`, `textContent`, `element.style`만 쓴다 (Trusted Types).
- 새 IPC 핸들러는 모두 `trusted(event)` 검사를 거친다.
- 자동 업데이트 기본값은 **OFF**, 채널 기본값은 **Stable**이다.
- 자동 모드는 앱 **종료 시** 설치한다. 재생 중 즉시 재시작하지 않는다.
- **다운그레이드는 자동 업데이트가 켜져 있어도 항상 수동**이다. 자동으로 내려받거나 설치하지 않고, 알림도 띄우지 않으며, 사용자가 설정 탭에서 직접 설치해야 한다.
- 버전 비교에 `semver`를 쓴다 (`electron-updater`의 의존성이므로 `package.json`에도 명시한다).
- 확인 주기: 시작 10초 후, 이후 6시간마다.
- 개발 실행(`!app.isPackaged`)에서는 확인하지 않는다.
- 작업 브랜치는 `feat/auto-update`다 (현재 `main`에서 분기한다).
- `main.js`/`preload.js`는 단위 테스트 대상이 아니다. 앱을 실행해 확인한다.

## Review Focus

- 자동 업데이트가 켜져 있어도 Pre-Release → Stable 전환 후 발견된 낮은 버전(다운그레이드)은 내려받지도, 종료 시 설치되지도 않는다 (Task 2).
- 오프라인에서 백그라운드 확인이 실패해도 화면에 오류를 띄우지 않는다 (Task 2).
- 다운로드 중에 수동 확인이나 채널 변경이 들어와도 진행 중인 다운로드를 끊지 않는다 (Task 2).
- 설치(다운로드) 도중 실패하면 `error`로 가되, 다시 확인/설치를 시도할 수 있어야 한다 (Task 2).
- 손상된 `settings.json`의 `autoUpdate`/`updateChannel` 값은 기본값(OFF/Stable)으로 복구된다 (Task 1).
- 같은 버전에 대해 알림이 반복되지 않는다 (Task 2의 `shouldNotify`, Task 3의 실행 확인).
- 이미 내려받은(`ready`) 업데이트가 있을 때 채널을 바꿔도 받은 업데이트는 유지된다. 이는 알려진 제한이며 Task 2 테스트로 고정한다.

---

### Task 1: 설정에 `autoUpdate`, `updateChannel` 추가

**Files:**
- Modify: `src/settings.js:100-106`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: 기존 `load(file)` / `save(file, settings)`.
- Produces: `load()`가 돌려주는 객체에 `autoUpdate: boolean`, `updateChannel: 'stable' | 'prerelease'`가 추가된다. `settings.js`는 `CHANNELS = ['stable', 'prerelease']`도 export한다.

- [ ] **Step 0: 브랜치 만들기**

```bash
git switch -c feat/auto-update
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/settings.test.js`의 `discord 설정은 …` 테스트 바로 뒤에 추가한다.

```js
test('autoUpdate는 기본 false이고 true일 때만 켜진다', () => {
  const f = tmp();
  assert.equal(s.load(f).autoUpdate, false);
  fs.writeFileSync(f, JSON.stringify({ autoUpdate: true }));
  assert.equal(s.load(f).autoUpdate, true);
  for (const bad of ['yes', 1, null, {}]) {
    fs.writeFileSync(f, JSON.stringify({ autoUpdate: bad }));
    assert.equal(s.load(f).autoUpdate, false, String(bad));
  }
});

test('updateChannel은 prerelease만 인정하고 나머지는 stable', () => {
  const f = tmp();
  assert.equal(s.load(f).updateChannel, 'stable');
  fs.writeFileSync(f, JSON.stringify({ updateChannel: 'prerelease' }));
  assert.equal(s.load(f).updateChannel, 'prerelease');
  for (const bad of ['beta', 'Prerelease', 1, null, {}]) {
    fs.writeFileSync(f, JSON.stringify({ updateChannel: bad }));
    assert.equal(s.load(f).updateChannel, 'stable', String(bad));
  }
});

test('깨진 파일이면 autoUpdate OFF, 채널 stable', () => {
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  const r = s.load(f);
  assert.equal(r.autoUpdate, false);
  assert.equal(r.updateChannel, 'stable');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/settings.test.js`
Expected: 새 테스트 3개가 FAIL (`undefined !== false` 등).

- [ ] **Step 3: 구현**

`src/settings.js`에서 `DEFAULT_WINDOW` 아래에 상수를 추가한다.

```js
const CHANNELS = Object.freeze(['stable', 'prerelease']);
```

`load()`의 반환문을 바꾼다.

```js
  return {
    shortcuts: loadShortcuts(raw),
    window: loadWindow(raw),
    discord: raw.discord !== false,
    autoUpdate: raw.autoUpdate === true,
    updateChannel: raw.updateChannel === 'prerelease' ? 'prerelease' : 'stable',
  };
```

`module.exports`를 바꾼다.

```js
module.exports = { ACTIONS, CHANNELS, DEFAULT_SHORTCUTS, validateAccelerator, load, save };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/settings.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/settings.js test/settings.test.js
git commit -m "feat: add autoUpdate and updateChannel settings"
```

---

### Task 2: `src/updater.js` 상태 모듈

**Files:**
- Create: `src/updater.js`
- Test: `test/updater.test.js`

**Interfaces:**
- Consumes: `electron-updater`의 `autoUpdater`와 같은 모양의 객체 (`EventEmitter` + `checkForUpdates()`, `downloadUpdate()`, `quitAndInstall(isSilent, isForceRunAfter)`, 프로퍼티 `autoDownload`, `autoInstallOnAppQuit`, `allowPrerelease`, `allowDowngrade`; `channel`은 설정하지 않는다).
- Produces:
  - `createUpdater({ autoUpdater, currentVersion, onState })` → `{ check({ manual }), install(), setAutoUpdate(on), setChannel(channel), getState() }`
  - 상태 객체: `{ status: 'idle'|'checking'|'available'|'downloading'|'ready'|'uptodate'|'error', version: string|null, percent: number, error: string|null, downgrade: boolean }`
  - `downgrade`는 발견된 버전이 설치된 버전보다 낮을 때 `true`다. **다운그레이드는 자동 업데이트가 켜져 있어도 자동으로 내려받거나 설치하지 않고**, `available`에서 사용자가 `install()`을 호출해야 한다.
  - 자동 다운로드는 `electron-updater`의 `autoDownload`에 맡기지 않고(항상 `false`) `updater.js`가 `update-available`에서 직접 `downloadUpdate()`를 호출해 다운그레이드를 걸러낸다.
  - `shouldNotify(state, notifiedVersion)` → boolean (다운그레이드는 알리지 않는다)
  - `DEV_MESSAGE` (문자열)
  - `autoUpdater`가 `null`이면 "개발 모드"로 동작한다. 수동 `check`만 `error` 상태(`DEV_MESSAGE`)를 만들고 나머지는 무시한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/updater.test.js`를 만든다.

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/updater.test.js`
Expected: FAIL (`Cannot find module '../src/updater'`).

- [ ] **Step 3: 구현**

`src/updater.js`를 만든다.

```js
// GitHub Releases 업데이트 상태 관리. electron-updater의 autoUpdater를 주입받아 쓰므로
// Electron 없이도 테스트할 수 있다. autoUpdater가 null이면(개발 실행) 아무것도 확인하지 않는다.
const DEV_MESSAGE = '개발 실행에서는 업데이트를 확인하지 않습니다.';
const FALLBACK_ERROR = '업데이트 중 오류가 발생했습니다.';
const PRERELEASE_VERSION = /^\d+\.\d+\.\d+-/;
const semver = require('semver');
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
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/updater.test.js`
Expected: 전부 PASS. 실패하는 테스트가 있으면 구현이 아니라 테스트 기대값이 스펙과 맞는지 먼저 확인한다.

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: 모든 파일 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/updater.js test/updater.test.js
git commit -m "feat: add updater state module"
```

---

### Task 3: 의존성, 빌드 설정, `main.js` 연결

**Files:**
- Modify: `package.json`
- Modify: `src/main.js:1,7,28-30,180-188,189-202(뒤),236-240,224-233`

**Interfaces:**
- Consumes: Task 1의 `settings.autoUpdate`, `settings.updateChannel`, `settingsStore.CHANNELS`. Task 2의 `createUpdater`, `shouldNotify`.
- Produces: IPC 채널
  - `settings:setAutoUpdate(on: boolean)` → `{ ok: true, autoUpdate } | { ok: false, reason }`
  - `settings:setUpdateChannel(channel: 'stable'|'prerelease')` → `{ ok: true, updateChannel } | { ok: false, reason }`
  - `update:check()` → `{ ok: boolean }`
  - `update:install()` → `{ ok: boolean }`
  - 푸시 `update:state` (main → renderer): 상태 객체
  - `settings:get` 응답에 `version`, `autoUpdate`, `updateChannel`, `update`(상태 객체 또는 null)가 추가된다.

- [ ] **Step 1: 의존성 설치**

Run: `npm install electron-updater semver`
Expected: `package.json`의 `dependencies`에 `electron-updater`와 `semver`가 추가된다 (`updater.js`가 `semver`를 직접 require하므로 명시한다).

주의: 이 설치 전에는 Task 2의 `require('semver')`가 `node_modules`에 없어 테스트가 실패할 수 있다. 그 경우 Task 2 Step 1 전에 이 Step 1만 먼저 실행한다.

- [ ] **Step 2: 채널/파일명 동작을 설치된 소스로 확인**

`node_modules/electron-updater/out/providers/GitHubProvider.js`를 읽고 아래를 확인한다.

이 단계는 `electron-updater` 6.8.9 소스를 미리 읽어 확인한 내용을, 실제 설치된 버전에서 다시 확인하는 것이다. 다음이 그대로인지 본다.

1. `allowPrerelease = false`: `/releases/latest`가 가리키는 최신 **정식** 릴리스만 보고 `latest.yml`을 읽는다.
2. `allowPrerelease = true`이고 설치 버전에 프리릴리스 태그가 없으면: atom 피드의 **첫 항목**(프리릴리스 포함 가장 새 릴리스)을 고른다.
3. 고른 릴리스 태그가 `1.2.0-beta.1`처럼 프리릴리스면 `beta.yml`을 먼저 시도하고, 404면 `latest.yml`로 폴백한다.
4. `autoUpdater.channel` setter가 `allowDowngrade = true`를 함께 켜므로, 우리 코드는 `channel`을 설정하지 않는다 (`setChannel`은 `allowPrerelease`/`allowDowngrade`만 다룬다).

결과가 다르면 Task 2의 `setChannel`과 테스트를 실제 동작에 맞게 고치고 이유를 커밋 메시지에 적는다. 릴리스 태그는 `v1.2.0-beta.1`처럼 유효한 semver여야 한다 (atom 피드 경로가 `semver.valid(tag)`를 요구한다).

- [ ] **Step 3: `package.json` 수정**

`scripts.dist`를 바꾼다 (로컬 빌드가 GitHub에 자동 발행되지 않도록 한다).

```json
    "dist": "electron-builder --win nsis --publish never"
```

`build` 안, `"directories"` 아래에 추가한다.

```json
    "publish": [
      {
        "provider": "github",
        "owner": "ddoiy13",
        "repo": "certy-music"
      }
    ],
```

- [ ] **Step 4: `main.js` — import와 상태 변수**

1번 줄을 바꾼다.

```js
const { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen, session, shell } = require('electron');
```

`const { createPresence } = require('./presence');` 아래에 추가한다.

```js
const { createUpdater, shouldNotify } = require('./updater');
```

`const PRESENCE_POLL_MS = 3000;` 아래에 추가한다.

```js
let updater = null;
let updateFirstTimer = null;
let updateTimer = null;
let notifiedVersion = null;
const UPDATE_FIRST_CHECK_MS = 10 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
```

- [ ] **Step 5: `main.js` — `startUpdater()`**

`startPresence()` 함수 바로 아래에 추가한다.

```js
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
          new Notification({ title: 'Certy Music', body: `새 버전 v${state.version}이 있습니다. 앱 설정에서 업데이트할 수 있습니다.` }).show();
        } catch (err) {
          console.error('업데이트 알림을 띄우지 못했습니다:', err);
        }
      }
    },
  });
  updater.setChannel(settings.updateChannel);
  updater.setAutoUpdate(settings.autoUpdate);
  updateFirstTimer = setTimeout(() => updater.check({ manual: false }), UPDATE_FIRST_CHECK_MS);
  updateTimer = setInterval(() => updater.check({ manual: false }), UPDATE_INTERVAL_MS);
}
```

- [ ] **Step 6: `main.js` — IPC**

`settings:get` 핸들러의 반환 객체를 바꾼다.

```js
  return {
    shortcuts: { ...settings.shortcuts },
    mediaKeys: MEDIA_KEYS,
    betterLyrics: !!blExt,
    discord: settings.discord,
    version: app.getVersion(),
    autoUpdate: settings.autoUpdate,
    updateChannel: settings.updateChannel,
    update: updater ? updater.getState() : null,
  };
```

`settings:setDiscord` 핸들러 바로 아래에 추가한다.

```js
ipcMain.handle('settings:setAutoUpdate', (event, on) => {
  if (!trusted(event) || typeof on !== 'boolean') return { ok: false, reason: '허용되지 않은 요청입니다.' };
  const previous = settings.autoUpdate;
  settings.autoUpdate = on;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('자동 업데이트 설정을 저장하지 못했습니다:', err);
    settings.autoUpdate = previous;
    return { ok: false, reason: '설정을 저장하지 못했습니다.' };
  }
  if (updater) updater.setAutoUpdate(on);
  return { ok: true, autoUpdate: on };
});
ipcMain.handle('settings:setUpdateChannel', (event, channel) => {
  if (!trusted(event) || !settingsStore.CHANNELS.includes(channel)) {
    return { ok: false, reason: '허용되지 않은 요청입니다.' };
  }
  const previous = settings.updateChannel;
  settings.updateChannel = channel;
  try {
    settingsStore.save(settingsFile(), settings);
  } catch (err) {
    console.error('빌드 버전 설정을 저장하지 못했습니다:', err);
    settings.updateChannel = previous;
    return { ok: false, reason: '설정을 저장하지 못했습니다.' };
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
```

- [ ] **Step 7: `main.js` — 시작과 종료**

`app.whenReady()` 안의 `startPresence();` 아래에 추가한다.

```js
    startUpdater();
```

`will-quit` 핸들러의 `clearInterval(presenceTimer);` 아래에 추가한다.

```js
    clearTimeout(updateFirstTimer);
    clearInterval(updateTimer);
```

- [ ] **Step 8: 기동 확인**

Run: `npm test` 그리고 `npm start`
Expected: 테스트 PASS. 앱이 오류 없이 뜬다 (개발 실행이라 업데이트 확인은 일어나지 않는다). 설정 탭 UI는 Task 4에서 붙인다.

- [ ] **Step 9: 커밋**

```bash
git add package.json package-lock.json src/main.js
git commit -m "feat: wire updater into main process"
```

---

### Task 4: 앱 설정 탭 "업데이트" 섹션 (`preload.js`)

**Files:**
- Modify: `src/preload.js` (`discordRow` 아래에 함수 추가, `renderPanel`, `hidePanel`, 파일 끝)

**Interfaces:**
- Consumes: Task 3의 IPC 채널과 `settings:get` 응답의 `version`, `autoUpdate`, `updateChannel`, `update`. `invokeSafe(channel, ...args)`, `h(tag, style, text)`, `BTN`, `PANEL_ID` (기존).
- Produces: 없음 (UI만).

- [ ] **Step 1: 섹션 구현**

`discordRow()` 함수 아래에 추가한다.

```js
const CHANNEL_LABELS = { stable: 'Stable', prerelease: 'Pre-Release' };
let renderUpdate = null; // 현재 열린 패널의 상태 갱신 함수. 패널이 닫히면 null

function updateText(u) {
  if (!u) return '';
  switch (u.status) {
    case 'checking': return '업데이트를 확인하는 중…';
    case 'uptodate': return '최신 버전입니다.';
    case 'available':
      return u.downgrade
        ? `이전 버전 v${u.version}으로 되돌릴 수 있습니다. 자동으로 설치되지 않습니다.`
        : `새 버전 v${u.version}을 설치할 수 있습니다.`;
    case 'downloading': return `v${u.version} 내려받는 중… ${u.percent}%`;
    case 'ready': return `v${u.version} 설치 준비가 끝났습니다.`;
    case 'error': return u.error || '업데이트 중 오류가 발생했습니다.';
    default: return '';
  }
}

function updateSection(state) {
  const box = h('div', { margin: '24px 0 0', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.15)' });
  box.appendChild(h('h3', { margin: '0 0 12px', font: '500 16px Roboto, sans-serif' }, '업데이트'));
  box.appendChild(h('div', { margin: '0 0 12px', opacity: '0.7' }, `현재 버전 v${state.version}`));

  const channelRow = h('div', { display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 12px' });
  channelRow.appendChild(h('div', { width: '140px' }, '빌드 버전'));
  const select = document.createElement('select');
  Object.assign(select.style, {
    padding: '6px 10px', background: '#212121', color: '#fff',
    border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', font: '14px Roboto, sans-serif',
  });
  for (const [value, label] of Object.entries(CHANNEL_LABELS)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = state.updateChannel;
  const channelErr = h('span', { color: '#ff6b6b', fontSize: '12px' });
  channelRow.append(select, channelErr);
  select.addEventListener('change', async (e) => {
    if (e.isTrusted !== true) return;
    const want = select.value;
    const r = await invokeSafe('settings:setUpdateChannel', want);
    if (r && r.ok) {
      channelErr.textContent = '';
    } else {
      select.value = state.updateChannel;
      channelErr.textContent = (r && r.reason) || '요청에 실패했습니다.';
      return;
    }
    state.updateChannel = want;
  });
  box.appendChild(channelRow);

  const status = h('div', { margin: '0 0 12px', minHeight: '21px' });
  const buttons = h('div', { display: 'flex', gap: '12px', margin: '0 0 12px' });
  const check = h('button', BTN, '업데이트 확인');
  const install = h('button', BTN, '업데이트 설치');
  buttons.append(check, install);
  check.addEventListener('click', (e) => {
    if (e.isTrusted !== true) return;
    invokeSafe('update:check');
  });
  install.addEventListener('click', (e) => {
    if (e.isTrusted !== true) return;
    invokeSafe('update:install');
  });

  renderUpdate = (u) => {
    status.textContent = updateText(u);
    status.style.color = u && u.status === 'error' ? '#ff6b6b' : '';
    const busy = u && (u.status === 'checking' || u.status === 'downloading');
    const canInstall = u && (u.status === 'available' || u.status === 'ready');
    check.disabled = !!busy;
    check.style.opacity = busy ? '0.5' : '1';
    install.style.display = canInstall ? '' : 'none';
    install.textContent = u && u.downgrade ? `v${u.version}으로 되돌리기` : '업데이트 설치';
  };
  renderUpdate(state.update);
  box.append(status, buttons);

  const autoRow = h('label', { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' });
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoBox.checked = !!state.autoUpdate;
  Object.assign(autoBox.style, { width: '16px', height: '16px', cursor: 'pointer' });
  const autoErr = h('span', { color: '#ff6b6b', fontSize: '12px' });
  autoRow.append(autoBox, h('span', {}, '자동 업데이트 (새 버전을 받아 두었다가 앱을 종료할 때 설치)'), autoErr);
  autoBox.addEventListener('change', async (e) => {
    if (e.isTrusted !== true) return;
    const want = autoBox.checked;
    const r = await invokeSafe('settings:setAutoUpdate', want);
    if (r && r.ok) {
      autoErr.textContent = '';
    } else {
      autoBox.checked = !want;
      autoErr.textContent = (r && r.reason) || '요청에 실패했습니다.';
    }
  });
  box.appendChild(autoRow);
  return box;
}
```

- [ ] **Step 2: 패널에 붙이기**

`renderPanel()`에서 Better Lyrics 버튼 블록(`if (state.betterLyrics) { … }`) **앞**에 한 줄을 추가한다.

```js
  panel.appendChild(updateSection(state));
```

- [ ] **Step 3: 상태 푸시 수신과 정리**

`hidePanel()`에서 `document.getElementById(PANEL_ID)?.remove();` 바로 아래에 추가한다.

```js
  renderUpdate = null;
```

파일 끝의 `window.addEventListener('DOMContentLoaded', …)` 위에 추가한다.

```js
ipcRenderer.on('update:state', (_event, u) => {
  if (renderUpdate && document.getElementById(PANEL_ID)) renderUpdate(u);
});
```

- [ ] **Step 4: 실행 확인 (개발 실행)**

Run: `YTM_DEBUG_PORT=9222 npm start` 후 앱에서 설정 → "앱 설정" 탭을 연다.
Expected:
- "업데이트" 섹션에 현재 버전, 빌드 버전(Stable/Pre-Release), [업데이트 확인], 자동 업데이트 체크박스가 보인다.
- [업데이트 확인]을 누르면 "개발 실행에서는 업데이트를 확인하지 않습니다."가 빨간 글씨로 나온다.
- 빌드 버전을 바꿨다가 설정 탭을 닫았다 다시 열면 값이 유지된다. 앱을 재시작해도 유지된다.
- 자동 업데이트 체크박스도 재시작 후 유지된다. `userData/settings.json`에서 `autoUpdate`, `updateChannel`을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/preload.js
git commit -m "feat: add update section to app settings tab"
```

---

### Task 5: 문서 갱신과 최종 검증

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1~4의 결과.
- Produces: 없음.

- [ ] **Step 1: `CLAUDE.md` 갱신**

`## Structure`의 `extension.js` 항목 아래에 추가한다.

```markdown
  - `updater.js`: wrapper around `electron-updater` for GitHub Releases updates. `createUpdater` takes an injectable `autoUpdater` (null in development runs, so nothing is checked) and keeps a status object (`idle/checking/available/downloading/ready/uptodate/error`). `main.js` checks 10 seconds after start and every 6 hours, pushes `update:state` to the settings tab, and shows a notification once per version. The settings tab has the "빌드 버전" (Stable / Pre-Release) select and the auto-update toggle (`settings:setUpdateChannel`, `settings:setAutoUpdate`). Auto-update is off by default and installs on quit; the install button downloads and restarts immediately.
```

`## Constraints to Follow` 끝에 추가한다.

```markdown
- **Release procedure**: bump `version` in `package.json` → `npm run dist` → upload `CertyMusic-Setup.exe`, its `.blockmap`, and `latest.yml` from `dist/` to a GitHub Release. Mark pre-release builds as "Pre-release" on GitHub (use a version like `1.2.0-beta.1`). The build writes `latest.yml` even for pre-release versions (verified with electron-builder 26.15.3). The Pre-Release setting only toggles `allowPrerelease`; do not set `autoUpdater.channel` (it forces `allowDowngrade` and breaks pre-release selection in `GitHubProvider`) and do not set `build.publish.channel` (it is baked into `app-update.yml` as the installed app's default channel, so switching to Stable would look for `beta.yml` in the stable release). Never build with `--publish always`. The packaged installer is not code-signed, so integrity relies only on the hash in `latest.yml`.
```

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 모든 파일 PASS.

- [ ] **Step 3: 빌드 산출물 확인**

Run: `npm run dist`
Expected: `dist/`에 `CertyMusic-Setup.exe`와 `latest.yml`이 생기고, `latest.yml`의 `version`이 `package.json`과 같다. GitHub에는 아무것도 올라가지 않는다 (`--publish never`).

- [ ] **Step 4: 설치본에서 설정 화면 확인**

`dist/CertyMusic-Setup.exe`로 설치해 실행하고 앱 설정 탭을 연다.
Expected: 현재 버전이 표시되고, [업데이트 확인]을 누르면 (릴리스가 아직 없거나 같은 버전이면) "최신 버전입니다." 또는 사유가 표시된다. 앱이 멈추거나 로그인이 풀리지 않는다.

- [ ] **Step 5: 실제 업데이트 end-to-end (사용자 수행)**

릴리스 두 개가 필요하므로 사용자가 직접 한다. 에이전트는 릴리스를 발행하지 않는다.
1. 이 기능이 들어간 `1.1.0`을 빌드해 GitHub Release로 올리고, 설치본을 직접 설치한다.
2. `package.json`을 `1.1.1`로 올려 빌드하고 새 릴리스로 올린다.
3. 설치된 1.1.0에서 [업데이트 확인] → 알림 → [업데이트 설치] → 재시작 후 버전이 1.1.1인지 확인한다.
4. 같은 방식으로 `1.2.0-beta.1`을 Pre-release로 올려 두고, Stable에서는 발견되지 않고 Pre-Release에서는 발견되는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: document updater and release procedure"
```
