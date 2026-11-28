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
