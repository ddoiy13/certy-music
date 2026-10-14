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

test('discord 설정은 기본 true이고 false만 끈다', () => {
  const f = tmp();
  assert.equal(s.load(f).discord, true);
  fs.writeFileSync(f, JSON.stringify({ discord: false }));
  assert.equal(s.load(f).discord, false);
  fs.writeFileSync(f, JSON.stringify({ discord: 'no' }));
  assert.equal(s.load(f).discord, true);
});

const PUNCT = ['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'];

test('구두점 키 11개는 Ctrl+Alt+ 와 함께 유효하다', () => {
  assert.equal(PUNCT.length, 11);
  for (const k of PUNCT) {
    assert.deepEqual(s.validateAccelerator(`Ctrl+Alt+${k}`), { ok: true, accelerator: `Ctrl+Alt+${k}` }, k);
  }
});

test('구두점 키의 수정자 대소문자/순서 변형은 정규화된다', () => {
  for (const v of ['ctrl+alt+`', 'CTRL+ALT+`', 'Alt+Ctrl+`', 'control+Alt+`']) {
    assert.deepEqual(s.validateAccelerator(v), { ok: true, accelerator: 'Ctrl+Alt+`' }, v);
  }
});

test('구두점 키도 수정자 없음/Shift만이면 거부된다', () => {
  for (const bad of ['`', ',', 'Shift+`', 'Shift+,']) {
    assert.equal(s.validateAccelerator(bad).ok, false, bad);
  }
});

test('구두점 단축키도 중복 검사된다', () => {
  assert.equal(s.validateAccelerator('alt+ctrl+`', ['Ctrl+Alt+`']).ok, false);
  assert.equal(s.validateAccelerator('Ctrl+Alt+,', ['Ctrl+Alt+`']).ok, true);
});

test('load()는 저장된 구두점 단축키를 받아들인다', () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ shortcuts: { playPause: 'Ctrl+Alt+`', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left' } }));
  assert.equal(s.load(f).shortcuts.playPause, 'Ctrl+Alt+`');
});
