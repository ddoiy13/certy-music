# Taskbar Thumbnail Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업표시줄 창 미리보기에 이전 곡, 재생/일시정지, 다음 곡 버튼을 넣는다.

**Architecture:** 새 모듈 `src/thumbar.js`가 아이콘 비트맵과 버튼 목록을 만들고 창에 설정한다. `main.js`는 `webContents`의 재생 이벤트를 전달하고, 언어 변경과 창 표시 때 다시 설정한다.

**Tech Stack:** Electron 44 (`BrowserWindow.setThumbarButtons`, `nativeImage.createFromBitmap`), `node:test`

**Spec:** `docs/superpowers/specs/2026-11-28-taskbar-thumbnail-buttons-design.md`

## Global Constraints

- 버튼은 이전, 재생/일시정지, 다음 3개이고 항상 표시한다. 설정 항목은 없다.
- 가운데 아이콘은 재생 중이면 일시정지, 아니면 재생이다. 시작 상태는 일시정지다.
- 클릭은 `main.js`의 `handlers`를 재사용한다.
- 툴팁 키는 `tray.prev`, `tray.playPause`, `tray.next`다. UI 문자열을 하드코딩하지 않는다.
- 이미지 파일을 추가하지 않는다. 새 의존성도 없다.
- `PRIVACY.md`는 바꾸지 않는다.
- 새 파일은 CRLF다. 콘솔 로그는 영어만 쓴다.
- 커밋은 `feat/taskbar-thumbnail-buttons` 브랜치에 한다. 푸시하지 않는다. `docs/milestones.md`는 커밋하지 않는다.

## Review Focus

- 창이 없거나 파괴된 뒤 재생 이벤트나 언어 변경이 오면 예외 없이 무시한다. (Task 1 테스트)
- `setThumbarButtons`가 예외를 던져도 앱은 계속 동작한다. (Task 1 테스트)
- 창을 새로 만들면 이전 창의 "재생 중" 상태가 남지 않는다. (Task 2 `createWindow`)
- 곡 전환, 광고, 페이지 새로고침 뒤에도 아이콘이 실제 상태와 맞는다. (Task 2 실행 확인)
- 트레이로 숨겼다 다시 열어도 버튼이 남는다. (Task 2 실행 확인)

---

### Task 1: `thumbar.js` 모듈

**Files:**
- Create: `src/thumbar.js`
- Create: `test/thumbar.test.js`
- Modify: `test/i18n.test.js` (검사 파일 목록에 `thumbar.js` 추가)

**Interfaces:**
- Produces:
  - `drawIcon(shape: 'prev'|'play'|'pause'|'next') -> Buffer`: 32x32 BGRA. 흰색 도형, 배경은 투명.
  - `createIcons(nativeImage) -> { prev, play, pause, next }`: `nativeImage.createFromBitmap(buffer, { width: 32, height: 32, scaleFactor: 2 })`
  - `buildButtons(t, playing, icons, actions) -> Array<{ tooltip, icon, click }>`: `actions`는 `{ prev, playPause, next }`
  - `createThumbar({ getWindow, getTranslator, icons, actions }) -> { setPlaying(playing: boolean): void, refresh(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/thumbar.test.js`)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { drawIcon, createIcons, buildButtons, createThumbar } = require('../src/thumbar');

const icons = { prev: 'P', play: 'PL', pause: 'PA', next: 'N' };
const actions = { prev() {}, playPause() {}, next() {} };
const t = (k) => k;

function fakeWindow() {
  const calls = [];
  return { calls, isDestroyed: () => false, setThumbarButtons: (b) => { calls.push(b); return true; } };
}

test('버튼은 이전, 재생/일시정지, 다음 순서이고 동작이 연결된다', () => {
  const b = buildButtons(t, false, icons, actions);
  assert.deepEqual(b.map((x) => x.tooltip), ['tray.prev', 'tray.playPause', 'tray.next']);
  assert.deepEqual(b.map((x) => x.click), [actions.prev, actions.playPause, actions.next]);
});

test('가운데 아이콘은 재생 중이면 일시정지, 아니면 재생', () => {
  assert.equal(buildButtons(t, false, icons, actions)[1].icon, 'PL');
  assert.equal(buildButtons(t, true, icons, actions)[1].icon, 'PA');
});

test('setPlaying은 상태를 반영하고, refresh는 상태를 유지한 채 현재 언어로 다시 설정한다', () => {
  const win = fakeWindow();
  let lang = 'a';
  const bar = createThumbar({ getWindow: () => win, getTranslator: () => (k) => `${lang}:${k}`, icons, actions });
  bar.setPlaying(true);
  lang = 'b';
  bar.refresh();
  assert.equal(win.calls.length, 2);
  assert.equal(win.calls[1][1].icon, 'PA');
  assert.equal(win.calls[1][1].tooltip, 'b:tray.playPause');
});

test('창이 없거나 파괴됐으면 아무것도 하지 않는다', () => {
  for (const w of [null, { isDestroyed: () => true, setThumbarButtons: () => assert.fail('called') }]) {
    const bar = createThumbar({ getWindow: () => w, getTranslator: () => t, icons, actions });
    assert.doesNotThrow(() => { bar.setPlaying(true); bar.refresh(); });
  }
});

test('setThumbarButtons가 예외를 던져도 밖으로 전파하지 않는다', () => {
  const w = { isDestroyed: () => false, setThumbarButtons: () => { throw new Error('boom'); } };
  const bar = createThumbar({ getWindow: () => w, getTranslator: () => t, icons, actions });
  assert.doesNotThrow(() => bar.refresh());
});

test('아이콘은 32x32 BGRA이고, 모양이 서로 다르며, 투명 배경에 흰 도형이다', () => {
  const all = ['prev', 'play', 'pause', 'next'].map(drawIcon);
  for (const buf of all) {
    assert.equal(buf.length, 32 * 32 * 4);
    assert.equal(buf[3], 0); // 왼쪽 위 모서리는 투명
    assert.ok(buf.includes(255));
  }
  assert.equal(new Set(all.map((b) => b.toString('base64'))).size, 4);
});

test('createIcons는 네 아이콘을 scaleFactor 2 비트맵으로 만든다', () => {
  const seen = [];
  const made = createIcons({ createFromBitmap: (_b, o) => { seen.push(o); return {}; } });
  assert.deepEqual(Object.keys(made), ['prev', 'play', 'pause', 'next']);
  for (const o of seen) assert.deepEqual(o, { width: 32, height: 32, scaleFactor: 2 });
});
```

- [ ] **Step 2: 실패 확인.** `node --test test/thumbar.test.js` → FAIL (`Cannot find module '../src/thumbar'`)

- [ ] **Step 3: `src/thumbar.js` 구현** (위 Interfaces의 네 함수를 export). 도형은 삼각형과 세로 막대로만 만든다. `prev`는 왼쪽 막대와 왼쪽 삼각형, `next`는 그 좌우 반전이다. `createThumbar`는 `playing = false`로 시작하고, 설정 실패는 `console.error('Failed to set the taskbar buttons:', err)`로 남긴다.

- [ ] **Step 4:** `test/i18n.test.js`의 파일 목록에 `'thumbar.js'`를 추가한다.

- [ ] **Step 5: 통과 확인.** `npm test` → 모두 PASS

- [ ] **Step 6: 커밋.** `git add src/thumbar.js test/thumbar.test.js test/i18n.test.js` → `feat: add taskbar thumbnail button module`

---

### Task 2: `main.js` 연결, 실행 확인, 문서

**Files:**
- Modify: `src/main.js` (`createWindow`, `settings:setLanguage`, `whenReady`)
- Modify: `CLAUDE.md` (Structure에 `thumbar.js` 항목, `test/` 항목에 `thumbar` 추가)

**Interfaces:**
- Consumes: Task 1의 `createIcons`, `createThumbar`

- [ ] **Step 1: 연결**
  - `whenReady`에서 `createWindow()`보다 먼저 `thumbar = createThumbar({ getWindow: () => win, getTranslator: () => i18n.createTranslator(currentLocale()), icons: createIcons(nativeImage), actions: handlers })`
  - `createWindow`에서 `win.webContents.on('media-started-playing', () => thumbar.setPlaying(true))`, `win.webContents.on('media-paused', () => thumbar.setPlaying(false))`, `win.on('show', () => thumbar.refresh())`
  - `createWindow` 끝에서 `thumbar.setPlaying(false)`를 호출한다. 처음 표시하고, 이전 창의 상태도 지운다.
  - `settings:setLanguage`의 `tray.refresh()` 옆에 `if (thumbar) thumbar.refresh();`

- [ ] **Step 2: 자동 테스트.** `npm test` → 모두 PASS

- [ ] **Step 3: 이벤트와 상태 일치 확인.** `YTM_DEBUG_PORT=9222`와 `--inspect=9230`으로 실행한다. 메인 프로세스에서 두 이벤트를 기록하고, `scripts/cdp.js`로 곡을 재생, 일시정지, 다음 곡으로 넘기며 매번 마지막 이벤트와 `video.paused`를 비교한다. 곡 전환 뒤와 새로고침 뒤도 본다.
  - 기대: 몇 초 안에 모두 일치. 어긋나면 이벤트를 버리고, 3초 간격으로 `player.readTrack(win.webContents)`의 `playing`을 `thumbar.setPlaying`에 넘기도록 바꾼다(트랙이 `null`이면 `false`). 아이콘이 같으면 다시 설정하지 않아도 된다.

- [ ] **Step 4: 사람이 확인** (자동화할 수 없음)
  - 미리보기에 버튼 3개가 보이고 각각 동작한다.
  - 재생과 일시정지에 따라 가운데 아이콘이 바뀐다.
  - 트레이로 숨겼다 다시 열어도 버튼이 남아 동작한다.
  - 언어를 바꾸면 툴팁이 바뀐다.
  - 밝은 테마와 어두운 테마에서 아이콘이 보인다. 안 보이면 `nativeTheme`에 따른 색 전환을 추가한다.

- [ ] **Step 5: 패키지 확인.** `npm run dist` 후 `dist/win-unpacked/Certy Music.exe`에서 버튼이 보이고 동작하는지 사람이 확인한다.

- [ ] **Step 6: `CLAUDE.md` 갱신.** 모듈 설명과, Step 3~5에서 실제로 확인한 것과 확인하지 못한 것을 적는다.

- [ ] **Step 7: 커밋.** `git add src/main.js CLAUDE.md` → `feat: show playback buttons in the taskbar preview`
