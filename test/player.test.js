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
