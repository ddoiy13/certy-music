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
