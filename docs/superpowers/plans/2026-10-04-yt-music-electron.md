# YT Music Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `music.youtube.com`을 감싼 Windows 포터블 Electron 앱. 전역 단축키(설정 탭에서 변경), Better Lyrics 확장 포함.

**Architecture:** 메인 프로세스(`src/main.js`)가 영구 세션 파티션의 창을 만들고 Better Lyrics를 같은 세션에 로드한다. 로직은 순수 모듈(`settings`, `shortcuts`, `player`)로 분리해 `node --test`로 검증한다. 설정 탭 UI는 preload(격리 월드)에서 DOM에 직접 주입하므로 페이지에 API를 노출하는 `contextBridge`는 쓰지 않는다(스펙 대비 의도적 변경: 노출 면적이 더 작다). 렌더러→메인 IPC는 `music.youtube.com` 프레임에서 온 것만 허용한다.

**Tech Stack:** Electron (최신 안정판), electron-builder(`portable`), Node 내장 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-04-yt-music-electron-design.md`

**Note:** 이 폴더는 git 저장소가 아니므로 커밋 단계는 없다. 대신 각 Task 끝의 검증이 체크포인트다. 스펙은 자동 테스트를 제외했으나, 순수 로직 3개 모듈에 한해 저비용 `node:test`를 추가한다.

## Global Constraints

- 대상: Windows 11, 포터블 단일 `.exe` (`electron-builder` 타깃 `portable`)
- 로드 URL: `https://music.youtube.com/`, 세션 파티션 `persist:ytmusic`
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload는 `electron`만 require, 단일 파일)
- 전역 단축키 동작 3개: `playPause`, `next`, `prev`. 기본값 `Ctrl+Alt+Space` / `Ctrl+Alt+Right` / `Ctrl+Alt+Left`. 미디어 키 `MediaPlayPause` / `MediaNextTrack` / `MediaPreviousTrack`은 고정이며 변경 불가
- 사용자 단축키는 Ctrl/Alt/Super 중 하나 이상 + 일반 키여야 함(Shift만으로는 불가), 동작 간 중복 불가
- 확장은 `extensions/better-lyrics/`에 스냅샷 복사(Vivaldi `effdbpeggelllpfkjppbokhmmiinhlmg` 2.4.1), `_metadata` 폴더는 제외
- 설정 파일: `userData/settings.json`
- YouTube는 Trusted Types를 쓰므로 주입 UI에서 `innerHTML` 금지, `createElement` + `textContent` + `element.style`만 사용
- 앱 이름/설명 등 사용자 노출 문구는 한국어
- 범위 제외: 트레이, 광고 차단, 단축키 외 설정 항목, 대체 설정 창, 확장 자동 업데이트

## Review Focus

1. 손상되었거나 손으로 편집된 `settings.json`(깨진 JSON, 잘못된 단축키, 중복): 크래시 없이 기본값으로 복구
2. 저장된 창 위치가 현재 연결되지 않은 모니터 밖: 보이는 화면 안에서 열림
3. 단축키 변경 시 다른 프로그램이 선점한 조합: 이전 단축키가 유지되고 오류 메시지 표시
4. 플레이어 바가 아직 없을 때(로드 전/로그아웃) 단축키 입력: 크래시·예외 없이 무시
5. 앱을 두 번 실행: 새 창이 아니라 기존 창이 앞으로 옴. `music.youtube.com` 외 프레임에서 온 IPC는 거부됨

---

### Task 1: 프로젝트 스캐폴드와 창 로드

**Files:**
- Create: `package.json`, `src/main.js`, `scripts/cdp.js`

**Interfaces:**
- Produces: `npm start`(앱 실행), `npm test`, `npm run dist`; `scripts/cdp.js` — `node scripts/cdp.js "<js 식>"`은 실행 중인 앱의 YouTube Music 페이지에서 식을 평가해 JSON 출력, `node scripts/cdp.js --targets`는 디버그 타깃 목록 출력(필요한 환경변수 `YTM_DEBUG_PORT`, 기본 9222)

- [ ] **Step 1: Node/npm 확인**

Run: `node --version; npm --version`
Expected: Node 22 이상(전역 `WebSocket`/`fetch` 필요). 미만이면 중단하고 사용자에게 알린다.

- [ ] **Step 2: `package.json` 작성**

```json
{
  "name": "yt-music-electron",
  "version": "1.0.0",
  "description": "YouTube Music 데스크톱 래퍼",
  "main": "src/main.js",
  "private": true,
  "scripts": {
    "start": "electron .",
    "test": "node --test test/",
    "dist": "electron-builder --win portable"
  },
  "build": {
    "appId": "local.ytmusic.electron",
    "productName": "YT Music",
    "directories": { "output": "dist" },
    "files": ["src/**/*", "package.json"],
    "extraResources": [
      { "from": "extensions/better-lyrics", "to": "extensions/better-lyrics" }
    ],
    "win": { "target": "portable", "signAndEditExecutable": false },
    "portable": { "artifactName": "YT-Music-portable.exe" }
  }
}
```

(`signAndEditExecutable: false`는 Windows에서 심볼릭 링크 권한 없이도 빌드되게 한다. 대신 exe 아이콘/버전 정보는 기본값이다.)

- [ ] **Step 3: 의존성 설치**

Run: `npm install --save-dev electron electron-builder`
Expected: 오류 없이 완료. 이후 `npx electron --version`으로 설치된 버전을 확인해 기록해 둔다.

- [ ] **Step 4: 최소 `src/main.js` 작성**

```js
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

const START_URL = 'https://music.youtube.com/';
const PARTITION = 'persist:ytmusic';
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/];

app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
if (process.env.YTM_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.YTM_DEBUG_PORT);
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow' };
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
  win.loadURL(START_URL);
  return win;
}

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|yt-music-electron)\/\S+/g, ''));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 5: `scripts/cdp.js` 작성**

```js
const port = process.env.YTM_DEBUG_PORT || '9222';
const arg = process.argv[2];

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  if (arg === '--targets') {
    for (const t of targets) console.log(`${t.type}\t${t.url}`);
    return;
  }
  const page =
    targets.find((t) => t.type === 'page' && /music\.youtube\.com/.test(t.url)) ||
    targets.find((t) => t.type === 'page');
  if (!page) {
    console.error('page target 없음');
    process.exit(1);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: arg, awaitPromise: true, returnByValue: true },
      }),
    );
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) {
      console.log(JSON.stringify(d.result?.result?.value ?? d.result, null, 2));
      ws.close();
    }
  };
  ws.onerror = () => {
    console.error('WebSocket 오류');
    process.exit(1);
  };
})();
```

- [ ] **Step 6: 실행해 창 로드와 UA 확인**

Run (백그라운드): `$env:YTM_DEBUG_PORT='9222'; npm start`
그 뒤: `node scripts/cdp.js "[location.href, navigator.userAgent]"`
Expected: `https://music.youtube.com/...` 이고 UA에 `Electron`이 없다.

- [ ] **Step 7: 로그인 가능 여부를 사용자와 확인**

사용자에게 앱 창에서 구글 로그인을 시도해 달라고 요청하고, "이 브라우저는 안전하지 않을 수 있음" 차단 여부를 묻는다. 차단되면 중단하고 원인(UA 외 client hints 등)을 조사해 보고한다. 이 시점에서 "장기 보장 불가" 위험을 다시 알린다. 로그인되면 앱을 종료하고 재시작해 로그인이 유지되는지도 확인한다.

---

### Task 2: 설정 모듈 (`settings.js`)

**Files:**
- Create: `src/settings.js`, `test/settings.test.js`

**Interfaces:**
- Produces:
  - `ACTIONS: string[]` = `['playPause','next','prev']`
  - `DEFAULT_SHORTCUTS: {playPause:string,next:string,prev:string}`
  - `validateAccelerator(acc: unknown, others?: string[]): {ok:true, accelerator:string} | {ok:false, reason:string}` — 정규화된 문자열 반환(`ctrl+alt+space` → `Ctrl+Alt+Space`)
  - `load(file: string): {shortcuts: {...}, window: {width:number,height:number,x?:number,y?:number,maximized?:boolean}}`
  - `save(file: string, settings): void` (임시 파일 후 rename)

- [ ] **Step 1: 실패하는 테스트 작성** (`test/settings.test.js`)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const s = require('../src/settings');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ytm-')), 'settings.json');

test('유효한 조합은 정규화된다', () => {
  assert.deepEqual(s.validateAccelerator('control+alt+space'), { ok: true, accelerator: 'Ctrl+Alt+Space' });
  assert.deepEqual(s.validateAccelerator('Alt+Ctrl+f5'), { ok: true, accelerator: 'Ctrl+Alt+F5' });
});

test('수정자 없는 키, Shift만, 수정자만, 형식 오류는 거부된다', () => {
  for (const bad of ['A', 'Space', 'Shift+A', 'Ctrl+Alt', 'Ctrl+', '+A', 'Ctrl+Alt+Foo', '', null, 42, 'MediaPlayPause']) {
    assert.equal(s.validateAccelerator(bad).ok, false, String(bad));
  }
});

test('다른 동작과 중복되면 거부된다 (대소문자/순서 무관)', () => {
  const r = s.validateAccelerator('alt+ctrl+Right', ['Ctrl+Alt+Right']);
  assert.equal(r.ok, false);
});

test('파일이 없으면 기본값', () => {
  const r = s.load(tmp());
  assert.deepEqual(r.shortcuts, s.DEFAULT_SHORTCUTS);
  assert.equal(r.window.width, 1280);
});

test('깨진 JSON이면 기본값', () => {
  const f = tmp();
  fs.writeFileSync(f, '{not json');
  assert.deepEqual(s.load(f).shortcuts, s.DEFAULT_SHORTCUTS);
});

test('저장된 단축키가 일부만 잘못되면 그 항목만 기본값으로 복구', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ shortcuts: { playPause: 'Ctrl+Alt+P', next: 'A', prev: 'Ctrl+Alt+O' } }));
  const r = s.load(f);
  assert.equal(r.shortcuts.playPause, 'Ctrl+Alt+P');
  assert.equal(r.shortcuts.next, s.DEFAULT_SHORTCUTS.next);
  assert.equal(r.shortcuts.prev, 'Ctrl+Alt+O');
});

test('저장된 값끼리 중복이면 전부 기본값', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ shortcuts: { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+P', prev: 'Ctrl+Alt+O' } }));
  assert.deepEqual(s.load(f).shortcuts, s.DEFAULT_SHORTCUTS);
});

test('기본값 복구가 다른 저장값과 겹치면 전부 기본값', () => {
  const f = tmp();
  // next가 prev의 기본값(Ctrl+Alt+Left)을 쓰고, prev는 무효 → prev가 기본값으로 복구되면 중복
  fs.writeFileSync(f, JSON.stringify({ shortcuts: { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+Left', prev: 'x' } }));
  assert.deepEqual(s.load(f).shortcuts, s.DEFAULT_SHORTCUTS);
});

test('창 크기가 비정상이면 기본값, 정상이면 유지', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ window: { width: 10, height: 'x' } }));
  assert.equal(s.load(f).window.width, 1280);
  fs.writeFileSync(f, JSON.stringify({ window: { width: 900, height: 700, x: 10, y: 20, maximized: true } }));
  assert.deepEqual(s.load(f).window, { width: 900, height: 700, x: 10, y: 20, maximized: true });
});

test('save 후 load하면 같은 값', () => {
  const f = tmp();
  const data = { shortcuts: { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+N', prev: 'Ctrl+Alt+B' }, window: { width: 800, height: 600 } };
  s.save(f, data);
  const r = s.load(f);
  assert.deepEqual(r.shortcuts, data.shortcuts);
  assert.equal(r.window.width, 800);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/settings.test.js`
Expected: FAIL (`Cannot find module '../src/settings'`)

- [ ] **Step 3: 구현** (`src/settings.js`)

```js
const fs = require('node:fs');
const path = require('node:path');

const ACTIONS = ['playPause', 'next', 'prev'];
const DEFAULT_SHORTCUTS = Object.freeze({
  playPause: 'Ctrl+Alt+Space',
  next: 'Ctrl+Alt+Right',
  prev: 'Ctrl+Alt+Left',
});
const DEFAULT_WINDOW = Object.freeze({ width: 1280, height: 800 });

const MODIFIER_ALIASES = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super' };
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
const NAMED_KEYS = [
  'Space', 'Up', 'Down', 'Left', 'Right', 'Enter', 'Tab', 'Backspace',
  'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
];

function resolveKey(key) {
  const up = key.toUpperCase();
  if (/^[A-Z0-9]$/.test(up) || /^F([1-9]|1\d|2[0-4])$/.test(up)) return up;
  return NAMED_KEYS.find((n) => n.toUpperCase() === up) || null;
}

function normalizeAccelerator(acc) {
  if (typeof acc !== 'string') return null;
  const parts = acc.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !p)) return null;
  const key = resolveKey(parts.pop());
  if (!key) return null;
  const mods = [];
  for (const p of parts) {
    const m = MODIFIER_ALIASES[p.toLowerCase()];
    if (!m) return null;
    if (!mods.includes(m)) mods.push(m);
  }
  if (!mods.some((m) => m !== 'Shift')) return null;
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods, key].join('+');
}

function validateAccelerator(acc, others = []) {
  const norm = normalizeAccelerator(acc);
  if (!norm) {
    return { ok: false, reason: 'Ctrl, Alt, Super 중 하나 이상과 일반 키를 함께 눌러야 합니다.' };
  }
  if (others.map(normalizeAccelerator).includes(norm)) {
    return { ok: false, reason: '다른 동작에 이미 사용 중인 조합입니다.' };
  }
  return { ok: true, accelerator: norm };
}

function loadShortcuts(raw) {
  const picked = {};
  const used = [];
  for (const action of ACTIONS) {
    const v = validateAccelerator(raw?.shortcuts?.[action], used);
    picked[action] = v.ok ? v.accelerator : null;
    if (v.ok) used.push(v.accelerator);
  }
  const shortcuts = {};
  for (const action of ACTIONS) shortcuts[action] = picked[action] || DEFAULT_SHORTCUTS[action];
  return new Set(Object.values(shortcuts)).size === ACTIONS.length ? shortcuts : { ...DEFAULT_SHORTCUTS };
}

function loadWindow(raw) {
  const w = raw?.window;
  const win = { ...DEFAULT_WINDOW };
  if (w && Number.isInteger(w.width) && w.width >= 400 && Number.isInteger(w.height) && w.height >= 300) {
    win.width = w.width;
    win.height = w.height;
    if (Number.isInteger(w.x) && Number.isInteger(w.y)) {
      win.x = w.x;
      win.y = w.y;
    }
    if (w.maximized === true) win.maximized = true;
  }
  return win;
}

function load(file) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {}
  return { shortcuts: loadShortcuts(raw), window: loadWindow(raw) };
}

function save(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { ACTIONS, DEFAULT_SHORTCUTS, validateAccelerator, load, save };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/settings.test.js`
Expected: 모든 테스트 PASS

---

### Task 3: 전역 단축키와 플레이어 제어

**Files:**
- Create: `src/shortcuts.js`, `src/player.js`, `test/shortcuts.test.js`, `test/player.test.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `settings.ACTIONS`, `settings.load/save`, `settings.DEFAULT_SHORTCUTS`
- Produces:
  - `shortcuts.MEDIA_KEYS: {playPause:'MediaPlayPause',next:'MediaNextTrack',prev:'MediaPreviousTrack'}`
  - `shortcuts.createShortcutManager(globalShortcut, handlers: Record<action, () => void>)` → `{ applyAll(shortcuts): string[] /*등록 실패한 accelerator들*/, change(action, accelerator): boolean /*실패 시 이전 값 복구*/ }`
  - `player.SELECTORS`, `player.control(webContents, action): Promise<boolean>` — 버튼을 눌렀으면 true, 버튼이 없거나 예외면 false(throw하지 않음)

- [ ] **Step 1: 실패하는 테스트 작성**

`test/shortcuts.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcutManager, MEDIA_KEYS } = require('../src/shortcuts');

function fakeGS(blocked = []) {
  const reg = new Map();
  return {
    reg,
    register(acc, fn) {
      if (blocked.includes(acc) || reg.has(acc)) return false;
      reg.set(acc, fn);
      return true;
    },
    unregister(acc) { reg.delete(acc); },
  };
}
const handlers = { playPause: () => {}, next: () => {}, prev: () => {} };
const defaults = { playPause: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left' };

test('applyAll은 미디어 키 3개와 사용자 조합 3개를 등록한다', () => {
  const gs = fakeGS();
  const failed = createShortcutManager(gs, handlers).applyAll(defaults);
  assert.deepEqual(failed, []);
  assert.equal(gs.reg.size, 6);
  for (const k of Object.values(MEDIA_KEYS)) assert.ok(gs.reg.has(k));
});

test('applyAll은 등록 실패한 조합을 돌려주고 나머지는 등록한다', () => {
  const gs = fakeGS(['Ctrl+Alt+Right']);
  const failed = createShortcutManager(gs, handlers).applyAll(defaults);
  assert.deepEqual(failed, ['Ctrl+Alt+Right']);
  assert.equal(gs.reg.size, 5);
});

test('change 성공 시 이전 조합은 해제되고 새 조합이 등록된다', () => {
  const gs = fakeGS();
  const m = createShortcutManager(gs, handlers);
  m.applyAll(defaults);
  assert.equal(m.change('next', 'Ctrl+Alt+N'), true);
  assert.ok(!gs.reg.has('Ctrl+Alt+Right'));
  assert.ok(gs.reg.has('Ctrl+Alt+N'));
});

test('change 실패(타 프로그램 선점) 시 이전 조합이 복구된다', () => {
  const gs = fakeGS(['Ctrl+Alt+N']);
  const m = createShortcutManager(gs, handlers);
  m.applyAll(defaults);
  assert.equal(m.change('next', 'Ctrl+Alt+N'), false);
  assert.ok(gs.reg.has('Ctrl+Alt+Right'));
  assert.ok(!gs.reg.has('Ctrl+Alt+N'));
});

test('change 실패 후에도 다시 변경할 수 있다 (이전 값 추적 유지)', () => {
  const gs = fakeGS(['Ctrl+Alt+N']);
  const m = createShortcutManager(gs, handlers);
  m.applyAll(defaults);
  m.change('next', 'Ctrl+Alt+N');
  assert.equal(m.change('next', 'Ctrl+Alt+M'), true);
  assert.ok(!gs.reg.has('Ctrl+Alt+Right'));
});
```

`test/player.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const player = require('../src/player');

test('control은 해당 동작의 셀렉터를 클릭하는 스크립트를 실행한다', async () => {
  let script = '';
  const wc = { executeJavaScript: async (s) => ((script = s), true) };
  assert.equal(await player.control(wc, 'next'), true);
  assert.ok(script.includes(JSON.stringify(player.SELECTORS.next)));
});

test('버튼이 없으면 false', async () => {
  const wc = { executeJavaScript: async () => false };
  assert.equal(await player.control(wc, 'playPause'), false);
});

test('실행 중 예외가 나도 throw하지 않고 false', async () => {
  const wc = { executeJavaScript: async () => { throw new Error('destroyed'); } };
  assert.equal(await player.control(wc, 'prev'), false);
});

test('알 수 없는 동작은 false', async () => {
  const wc = { executeJavaScript: async () => true };
  assert.equal(await player.control(wc, 'bogus'), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/shortcuts.test.js test/player.test.js`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/shortcuts.js`:

```js
const { ACTIONS } = require('./settings');

const MEDIA_KEYS = Object.freeze({
  playPause: 'MediaPlayPause',
  next: 'MediaNextTrack',
  prev: 'MediaPreviousTrack',
});

function createShortcutManager(globalShortcut, handlers) {
  const custom = {};

  function applyAll(shortcuts) {
    const failed = [];
    for (const action of ACTIONS) {
      if (!globalShortcut.register(MEDIA_KEYS[action], handlers[action])) failed.push(MEDIA_KEYS[action]);
      if (globalShortcut.register(shortcuts[action], handlers[action])) custom[action] = shortcuts[action];
      else failed.push(shortcuts[action]);
    }
    return failed;
  }

  function change(action, next) {
    const prev = custom[action];
    if (prev) globalShortcut.unregister(prev);
    if (globalShortcut.register(next, handlers[action])) {
      custom[action] = next;
      return true;
    }
    if (prev && globalShortcut.register(prev, handlers[action])) custom[action] = prev;
    else delete custom[action];
    return false;
  }

  return { applyAll, change };
}

module.exports = { MEDIA_KEYS, createShortcutManager };
```

`src/player.js`:

```js
// YouTube Music DOM이 바뀌면 여기만 고친다. (Task 3 Step 6에서 실제 DOM으로 확인)
const SELECTORS = Object.freeze({
  playPause: 'ytmusic-player-bar #play-pause-button',
  next: 'ytmusic-player-bar .next-button',
  prev: 'ytmusic-player-bar .previous-button',
});

function clickScript(selector) {
  return `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return false; b.click(); return true; })()`;
}

async function control(webContents, action) {
  const selector = SELECTORS[action];
  if (!selector) return false;
  try {
    return (await webContents.executeJavaScript(clickScript(selector))) === true;
  } catch {
    return false;
  }
}

module.exports = { SELECTORS, control };
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: settings/shortcuts/player 테스트 모두 PASS

- [ ] **Step 5: `src/main.js`에 설정·단축키·IPC·창 상태 연결**

`src/main.js` 전체를 아래로 교체한다(Task 1의 내용을 포함하며, Task 4·5에서 확장 로드와 preload가 추가된다).

```js
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const settingsStore = require('./settings');
const { createShortcutManager, MEDIA_KEYS } = require('./shortcuts');
const player = require('./player');

const START_URL = 'https://music.youtube.com/';
const PARTITION = 'persist:ytmusic';
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/];

app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
if (process.env.YTM_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.YTM_DEBUG_PORT);
}

let win = null;
let settings = null;
let shortcuts = null;

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
    },
  });
  if (b.maximized) win.maximize();

  win.on('close', () => {
    const n = win.getNormalBounds();
    settings.window = { width: n.width, height: n.height, x: n.x, y: n.y, maximized: win.isMaximized() };
    settingsStore.save(settingsFile(), settings);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow' };
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
  win.loadURL(START_URL);
}

function controlPlayer(action) {
  if (win && !win.isDestroyed()) player.control(win.webContents, action);
}

const handlers = {
  playPause: () => controlPlayer('playPause'),
  next: () => controlPlayer('next'),
  prev: () => controlPlayer('prev'),
};

// IPC는 music.youtube.com 프레임에서 온 것만 받는다.
function trusted(event) {
  try {
    return new URL(event.senderFrame.url).hostname === 'music.youtube.com';
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
  settings.shortcuts[action] = v.accelerator;
  settingsStore.save(settingsFile(), settings);
  return { ok: true, shortcuts: { ...settings.shortcuts } };
}

ipcMain.handle('settings:get', (event) => {
  if (!trusted(event)) return null;
  return {
    shortcuts: { ...settings.shortcuts },
    mediaKeys: MEDIA_KEYS,
    betterLyrics: false,
  };
});
ipcMain.handle('settings:setShortcut', (event, action, accelerator) =>
  trusted(event) ? applyShortcut(action, accelerator) : { ok: false, reason: '허용되지 않은 요청입니다.' },
);
ipcMain.handle('settings:resetShortcut', (event, action) =>
  trusted(event) ? applyShortcut(action, settingsStore.DEFAULT_SHORTCUTS[action]) : { ok: false, reason: '허용되지 않은 요청입니다.' },
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|yt-music-electron)\/\S+/g, ''));
    settings = settingsStore.load(settingsFile());
    createWindow();
    shortcuts = createShortcutManager(globalShortcut, handlers);
    const failed = shortcuts.applyAll(settings.shortcuts);
    if (failed.length) console.warn('등록 실패한 단축키:', failed.join(', '));
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
```

- [ ] **Step 6: 실제 DOM으로 플레이어 셀렉터 확인**

Run (백그라운드): `$env:YTM_DEBUG_PORT='9222'; npm start`
사용자에게 앱에서 아무 곡이나 재생해 달라고 요청한다. 그 뒤:
`node scripts/cdp.js "['ytmusic-player-bar #play-pause-button','ytmusic-player-bar .next-button','ytmusic-player-bar .previous-button'].map(s => !!document.querySelector(s))"`
Expected: `[true, true, true]`. false가 있으면 `node scripts/cdp.js "document.querySelector('ytmusic-player-bar')?.outerHTML.slice(0,4000)"`로 실제 구조를 보고 `src/player.js`의 `SELECTORS`를 고친 뒤 재확인한다.

- [ ] **Step 7: 단축키 동작 확인**

앱이 최소화/다른 창 활성 상태에서 `Ctrl+Alt+Space`, `Ctrl+Alt+Right`, `Ctrl+Alt+Left`와 키보드 미디어 키(있으면)가 재생/다음/이전을 동작시키는지 사용자에게 확인받는다. 확인 불가한 키(미디어 키 없는 키보드)는 "미확인"으로 보고한다. 실패 시 `MediaSessionService` 비활성화와 키 선점 여부(`console.warn` 출력)를 먼저 의심한다.

- [ ] **Step 8: 회귀 확인 (Review Focus 3·4·5 일부)**

- 로그인 전/곡 없음 상태에서 단축키 입력 시 앱이 죽지 않는다(`player.test.js`가 보장).
- 앱을 한 번 더 실행하면 새 창이 생기지 않고 기존 창이 앞으로 온다.
- `settings.json`에 `"window":{"width":900,"height":700,"x":-32000,"y":-32000}`를 써 넣고 재시작하면 창이 화면 안에서 열린다(`userData`는 `%APPDATA%\yt-music-electron`).

---

### Task 4: Better Lyrics 확장

**Files:**
- Create: `src/extension.js`, `extensions/better-lyrics/**` (복사본)
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `main.js`의 `PARTITION`, `settings:get` 핸들러
- Produces: `extension.load(ses): Promise<Electron.Extension | null>`, `extension.openOptions(ses, ext): BrowserWindow` (이미 열려 있으면 그 창을 포커스), IPC `bl:openOptions` → `{ok:boolean}`, `settings:get`의 `betterLyrics: boolean`

- [ ] **Step 1: 확장 스냅샷 복사 (`_metadata` 제외)**

Run (PowerShell):

```powershell
$src = "$env:LOCALAPPDATA\Vivaldi\User Data\Default\Extensions\effdbpeggelllpfkjppbokhmmiinhlmg\2.4.1_0"
$dst = "extensions\better-lyrics"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
if (Test-Path "$dst\_metadata") { Remove-Item "$dst\_metadata" -Recurse -Force }
Test-Path "$dst\manifest.json"
```

Expected: `True`. 복사본에 `LICENSE` 계열 파일이 있는지도 `Get-ChildItem extensions\better-lyrics -Filter LICENSE*`로 확인하고, 있으면 위치를 사용자에게 알린다.

- [ ] **Step 2: `src/extension.js` 작성**

```js
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
```

- [ ] **Step 3: `src/main.js`에 연결**

상단 require에 추가: `const betterLyrics = require('./extension');`
`let shortcuts = null;` 아래에 추가: `let blExt = null;`
`settings:get` 핸들러의 `betterLyrics: false,`를 `betterLyrics: !!blExt,`로 바꾼다.
`settings:resetShortcut` 핸들러 아래에 추가:

```js
ipcMain.handle('bl:openOptions', (event) => {
  if (!trusted(event) || !blExt) return { ok: false };
  betterLyrics.openOptions(session.fromPartition(PARTITION), blExt);
  return { ok: true };
});
```

`app.whenReady()` 콜백에서 `settings = ...` 앞에 추가(창을 만들기 전에 로드해야 한다):

```js
    blExt = await betterLyrics.load(ses);
```

그리고 콜백을 `async () => {`로 바꾼다.

- [ ] **Step 4: 확장 로드/동작 확인 (실측)**

Run (백그라운드): `$env:YTM_DEBUG_PORT='9222'; npm start`
1. 콘솔에 `Better Lyrics 로드 실패`가 없는지 확인한다.
2. `node scripts/cdp.js --targets`
Expected: `service_worker	chrome-extension://effdbpeggelllpfkjppbokhmmiinhlmg/...`가 보인다. 없으면 서비스 워커 미지원/종료 가능성이 있으므로, 이 사실과 함께 사용자에게 보고하고 진행 여부를 묻는다(스펙의 "동작하지 않으면 원인을 보고하고 대안 제안").
3. 가사 DOM 클래스를 확인한다: `Grep -o "blyrics-container" extensions/better-lyrics/content_scripts/content-0.js` 등으로 실제 클래스명을 찾는다.
4. 사용자가 곡을 재생하고 가사 탭을 연 상태에서 `node scripts/cdp.js "!!document.querySelector('.blyrics-container')"`(3에서 확인한 클래스명 사용)을 실행하고, 사용자에게 가사가 Better Lyrics 스타일로 표시되는지 눈으로 확인받는다.
5. 단축키 3종이 Better Lyrics 설치 상태에서도 동작하는지(Task 3 Step 6의 셀렉터 확인 포함) 재확인한다.

Expected: 가사 컨테이너 존재 + 사용자가 표시 확인. 부분 동작이면 어떤 content script(`world: MAIN` 등)가 실패하는지 `node scripts/cdp.js` 콘솔 에러 조회로 원인을 좁혀 보고한다.

---

### Task 5: 설정 탭 주입 (preload)

**Files:**
- Create: `src/preload.js`
- Modify: `src/main.js` (`webPreferences.preload` 추가)

**Interfaces:**
- Consumes: IPC `settings:get` → `{shortcuts, mediaKeys, betterLyrics}`, `settings:setShortcut(action, acc)` / `settings:resetShortcut(action)` → `{ok:true, shortcuts}` | `{ok:false, reason}`, `bl:openOptions`
- Produces: YouTube Music 설정 화면의 탭 목록에 "앱 설정" 탭과 패널

- [ ] **Step 1: preload 연결**

`src/main.js`의 `webPreferences`에 `preload: path.join(__dirname, 'preload.js'),` 한 줄을 추가한다(`sandbox: true`는 유지한다. preload는 단일 파일이고 `electron`만 require해야 한다).

- [ ] **Step 2: `src/preload.js` 작성**

아래 `SEL` 값은 **초기 추정치**이며 Step 3에서 실제 DOM으로 검증·수정한다. 나머지 코드는 그대로 쓴다.

```js
const { ipcRenderer } = require('electron');

const TAB_ID = 'app-settings-tab';
const PANEL_ID = 'app-settings-panel';
const LABELS = { playPause: '재생 / 일시정지', next: '다음 곡', prev: '이전 곡' };

// YouTube Music 설정 화면 DOM. 바뀌면 여기만 고친다. (Step 3에서 실측으로 확정)
const SEL = {
  page: 'ytmusic-settings-page',
  tabList: 'tp-yt-paper-tabs',
  tabItem: 'tp-yt-paper-tab',
  tabLabel: 'yt-formatted-string',
  content: '#contents',
};

const BTN = {
  padding: '6px 14px',
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: '18px',
  cursor: 'pointer',
  font: '14px Roboto, sans-serif',
};

// Trusted Types 때문에 innerHTML을 쓰지 않는다.
function h(tag, style = {}, text = '') {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  if (text) el.textContent = text;
  return el;
}

function codeToKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const map = {
    Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  };
  return map[code] || null;
}

function keyToAccelerator(e) {
  const key = codeToKey(e.code);
  if (!key) return null; // 수정자 키만 눌린 경우 등
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}

function showResult(result, action, btn, err, fallbackText) {
  if (result.ok) {
    btn.textContent = result.shortcuts[action];
    err.textContent = '';
  } else {
    btn.textContent = fallbackText;
    err.textContent = result.reason;
  }
}

function record(action, btn, err) {
  const prev = btn.textContent;
  btn.textContent = '키를 누르세요… (Esc 취소)';
  err.textContent = '';
  function cleanup() {
    window.removeEventListener('keydown', onKey, true);
    btn.removeEventListener('blur', onBlur);
  }
  async function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      cleanup();
      btn.textContent = prev;
      return;
    }
    const acc = keyToAccelerator(e);
    if (!acc) return;
    cleanup();
    showResult(await ipcRenderer.invoke('settings:setShortcut', action, acc), action, btn, err, prev);
  }
  function onBlur() {
    cleanup();
    btn.textContent = prev;
  }
  window.addEventListener('keydown', onKey, true);
  btn.addEventListener('blur', onBlur);
}

function shortcutRow(action, state) {
  const row = h('div', { display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 16px' });
  row.appendChild(h('div', { width: '140px' }, LABELS[action]));
  const btn = h('button', BTN, state.shortcuts[action]);
  const reset = h('button', BTN, '초기화');
  const err = h('div', { color: '#ff6b6b', fontSize: '12px' });
  row.append(btn, reset, err);
  btn.addEventListener('click', () => record(action, btn, err));
  reset.addEventListener('click', async () => {
    const prev = btn.textContent;
    showResult(await ipcRenderer.invoke('settings:resetShortcut', action), action, btn, err, prev);
  });
  return row;
}

async function renderPanel() {
  const state = await ipcRenderer.invoke('settings:get');
  if (!state) return null;
  const panel = h('div', { padding: '24px 32px', color: '#fff', font: '14px/1.5 Roboto, sans-serif', maxWidth: '640px' });
  panel.id = PANEL_ID;
  panel.appendChild(h('h2', { margin: '0 0 8px', font: '500 20px Roboto, sans-serif' }, '앱 설정'));
  panel.appendChild(
    h('p', { margin: '0 0 24px', opacity: '0.7' },
      `전역 단축키: 다른 프로그램을 쓰는 중에도 동작합니다. 미디어 키(${Object.values(state.mediaKeys).join(', ')})는 항상 함께 동작합니다.`),
  );
  for (const action of Object.keys(LABELS)) panel.appendChild(shortcutRow(action, state));
  if (state.betterLyrics) {
    const open = h('button', { ...BTN, marginTop: '16px' }, 'Better Lyrics 설정 열기');
    open.addEventListener('click', () => ipcRenderer.invoke('bl:openOptions'));
    panel.appendChild(open);
  }
  return panel;
}

function hidePanel(page) {
  document.getElementById(PANEL_ID)?.remove();
  const content = page.querySelector(SEL.content);
  if (content) content.style.display = '';
  document.getElementById(TAB_ID)?.removeAttribute('selected');
}

async function showPanel(page) {
  hidePanel(page);
  const content = page.querySelector(SEL.content);
  if (!content) return;
  const panel = await renderPanel();
  if (!panel) return;
  content.style.display = 'none';
  content.insertAdjacentElement('afterend', panel);
  document.getElementById(TAB_ID)?.setAttribute('selected', '');
}

function ensureTab() {
  const page = document.querySelector(SEL.page);
  if (!page) return;
  const list = page.querySelector(SEL.tabList);
  const sample = list && list.querySelector(SEL.tabItem);
  if (!sample || list.querySelector(`#${TAB_ID}`)) return;

  const tab = sample.cloneNode(true);
  tab.id = TAB_ID;
  tab.removeAttribute('selected');
  tab.removeAttribute('aria-selected');
  (tab.querySelector(SEL.tabLabel) || tab).textContent = '앱 설정';
  tab.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPanel(page);
    },
    true,
  );
  list.appendChild(tab);

  if (!list.__appSettingsBound) {
    list.__appSettingsBound = true;
    list.addEventListener(
      'click',
      (e) => {
        if (!e.target.closest(`#${TAB_ID}`)) hidePanel(page);
      },
      true,
    );
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensureTab();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
});
```

- [ ] **Step 3: 설정 화면 실제 DOM 확인 및 `SEL` 확정**

Run (백그라운드): `$env:YTM_DEBUG_PORT='9222'; npm start`
사용자에게 로그인된 상태에서 프로필 메뉴 → 설정을 열어 달라고 요청한다(설정 화면이 열려 있어야 아래 명령이 의미 있다). 그 뒤:

1. `node scripts/cdp.js "(() => { const p = document.querySelector('ytmusic-settings-page'); return p ? p.outerHTML.slice(0, 8000) : 'no ytmusic-settings-page: ' + location.href })()"`
2. 출력에서 설정 화면 루트 요소, 왼쪽 탭 목록 컨테이너, 탭 항목, 탭 텍스트 요소, 오른쪽 내용 영역을 찾아 `SEL`의 5개 값을 실제 셀렉터로 고친다. 루트 요소 이름이 다르면(`no ytmusic-settings-page`가 출력되면) 그 URL과 DOM에서 설정 화면을 식별해 `SEL.page`부터 정한다.
3. 설정 화면의 탭이 `<a>` 링크라서 클릭 시 라우팅이 일어나는 구조이거나, 탭 선택 표시가 `selected` 속성이 아닌 다른 방식(`aria-selected`, 클래스)이면 `ensureTab`/`showPanel`/`hidePanel`의 선택 표시 처리를 그 방식에 맞게 수정한다.

Expected: 셀렉터 5개가 모두 실제 요소와 일치(예: `node scripts/cdp.js "Object.values({...}).map(...)"`로 각 셀렉터가 요소를 찾는지 확인).

- [ ] **Step 4: 탭 주입 동작 확인**

앱 재시작 후 사용자에게 설정 화면을 열어 달라고 요청하고 확인한다:
1. `node scripts/cdp.js "!!document.getElementById('app-settings-tab')"` → `true`
2. "앱 설정" 탭 클릭 시 패널이 보이고 기존 내용은 숨겨지며, 다른 탭 클릭 시 원래 내용이 돌아온다(사용자 육안 확인).
3. 설정 화면을 닫았다 다시 열어도 탭이 다시 생긴다.

탭이 안 생기거나 UI가 깨지면 원인을 보고하고 중단한다(대체 설정 창은 스펙상 별도 작업).

- [ ] **Step 5: 단축키 변경 흐름 확인 (Review Focus 3)**

패널에서 다음을 사용자와 확인한다:
1. 재생 버튼 클릭 → `Ctrl+Alt+P` 입력 → 표시 변경, 새 조합으로 재생/일시정지 동작, 옛 조합은 더 이상 동작하지 않음
2. `A`만 누르거나 `Shift+A`를 누르면 "Ctrl, Alt, Super 중 하나 이상…" 오류 표시, 값 유지
3. 다음 곡을 `Ctrl+Alt+P`로 바꾸려 하면 "이미 사용 중" 오류 표시
4. 다른 프로그램이 쓰는 조합(예: Windows가 선점한 `Super+L`)을 시도하면 "다른 프로그램이 사용 중…" 오류 표시, 이전 값 유지
5. 초기화 버튼 → 기본값 복귀
6. 앱 재시작 후 변경한 값이 유지됨, `Better Lyrics 설정 열기` 버튼이 확장 옵션 창을 연다(두 번 눌러도 창이 하나)
7. 페이지 콘솔에서 `settings:*` IPC를 외부 프레임이 호출하지 못하는 것은 `trusted()` 로직으로 보장된다(코드 검토로 갈음, 직접 재현 불가하면 "미검증"으로 보고).

---

### Task 6: 포터블 빌드와 최종 검증

**Files:**
- Modify: 없음 (필요 시 `package.json`의 `build` 수정)

**Interfaces:**
- Consumes: 모든 이전 Task
- Produces: `dist/YT-Music-portable.exe`

- [ ] **Step 1: 테스트 전체 실행**

Run: `npm test`
Expected: 모든 테스트 PASS

- [ ] **Step 2: 포터블 빌드**

Run: `npm run dist`
Expected: `dist/YT-Music-portable.exe` 생성. 첫 빌드는 electron-builder가 NSIS 리소스를 내려받아 시간이 걸릴 수 있다. 실패하면 오류 전문을 보고한다(권한/네트워크 원인 구분).

- [ ] **Step 3: 빌드 결과 실행 검증**

Run (백그라운드): `$env:YTM_DEBUG_PORT='9222'; .\dist\YT-Music-portable.exe`
1. `node scripts/cdp.js --targets` → 페이지 타깃 존재 + Better Lyrics 서비스 워커 타깃 존재(패키지 경로 `process.resourcesPath` 로드 확인)
2. 로그인 유지, 재생, 단축키 3종, 설정 탭, Better Lyrics 가사 표시를 사용자에게 한 번 더 확인받는다.
3. 앱을 종료하고 재실행해 창 크기/위치와 단축키 설정이 유지되는지 확인한다.

- [ ] **Step 4: 결과 보고**

사용자에게 다음을 정리해 보고한다: 검증된 항목, 미검증/제한 항목(미디어 키 하드웨어 유무, 구글 로그인 정책 변경 가능성, SmartScreen 경고, Better Lyrics 스냅샷 수동 갱신 방법 = `extensions/better-lyrics`를 Vivaldi의 새 버전 폴더로 다시 복사 후 `_metadata` 삭제, 라이선스 확인 필요).
