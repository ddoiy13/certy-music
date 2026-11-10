const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldHideOnClose, buildMenuTemplate, createTray } = require('../src/tray');

const t = (key) => `T:${key}`;
const actions = { open() {}, playPause() {}, prev() {}, next() {}, quit() {} };

test('트레이 모드일 때만 닫기가 창을 숨긴다', () => {
  assert.equal(shouldHideOnClose('tray', false), true);
  assert.equal(shouldHideOnClose('quit', false), false);
  assert.equal(shouldHideOnClose(undefined, false), false);
});

test('앱을 끄는 중이면 트레이 모드여도 닫기를 막지 않는다', () => {
  assert.equal(shouldHideOnClose('tray', true), false);
});

test('메뉴는 열기, 재생/일시정지, 이전, 다음, 종료 순서이고 각 항목이 동작에 연결된다', () => {
  const items = buildMenuTemplate(t, actions);
  const real = items.filter((i) => i.type !== 'separator');
  assert.deepEqual(real.map((i) => i.label), ['T:tray.open', 'T:tray.playPause', 'T:tray.prev', 'T:tray.next', 'T:tray.quit']);
  assert.deepEqual(real.map((i) => i.click), [actions.open, actions.playPause, actions.prev, actions.next, actions.quit]);
});

function fakeElectron() {
  const log = { menus: [], handlers: {}, destroyed: false, tooltip: null };
  class Tray {
    constructor(icon) { log.icon = icon; }
    setToolTip(s) { log.tooltip = s; }
    on(name, fn) { log.handlers[name] = fn; }
    setContextMenu(m) { log.menu = m; }
    destroy() { log.destroyed = true; }
  }
  const Menu = { buildFromTemplate: (tpl) => { log.menus.push(tpl); return { tpl }; } };
  return { Tray, Menu, log };
}

test('createTray는 더블클릭에 열기를 연결하고 메뉴를 설정한다', () => {
  const { Tray, Menu, log } = fakeElectron();
  createTray({ Tray, Menu }, { icon: 'ICON', getTranslator: () => t, actions });
  assert.equal(log.icon, 'ICON');
  assert.equal(log.handlers['double-click'], actions.open);
  assert.equal(log.menus.length, 1);
  assert.equal(log.menu.tpl[0].label, 'T:tray.open');
});

test('refresh는 새 번역으로 메뉴를 다시 만들고 destroy는 트레이를 없앤다', () => {
  const { Tray, Menu, log } = fakeElectron();
  let tr = t;
  const tray = createTray({ Tray, Menu }, { icon: 'ICON', getTranslator: () => tr, actions });
  tr = (key) => `K:${key}`;
  tray.refresh();
  assert.equal(log.menus.length, 2);
  assert.equal(log.menu.tpl[0].label, 'K:tray.open');
  tray.destroy();
  assert.equal(log.destroyed, true);
});
