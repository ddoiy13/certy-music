// 시스템 트레이 아이콘과 메뉴. electron 클래스는 주입받아 테스트에서 가짜로 바꿀 수 있다.

// 닫기 버튼을 눌렀을 때 창을 숨길지 정한다. 앱을 끄는 중이면 막지 않는다.
function shouldHideOnClose(closeAction, quitting) {
  return closeAction === 'tray' && !quitting;
}

function buildMenuTemplate(t, actions) {
  return [
    { label: t('tray.open'), click: actions.open },
    { type: 'separator' },
    { label: t('tray.playPause'), click: actions.playPause },
    { label: t('tray.prev'), click: actions.prev },
    { label: t('tray.next'), click: actions.next },
    { type: 'separator' },
    { label: t('tray.quit'), click: actions.quit },
  ];
}

// getTranslator는 현재 언어의 t 함수를 돌려준다. 언어가 바뀔 때 refresh()로 메뉴를 다시 만든다.
function createTray({ Tray, Menu }, { icon, getTranslator, actions }) {
  const tray = new Tray(icon);
  tray.setToolTip('Certy Music');
  tray.on('double-click', actions.open);
  function refresh() {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(getTranslator(), actions)));
  }
  refresh();
  return { refresh, destroy: () => tray.destroy() };
}

module.exports = { shouldHideOnClose, buildMenuTemplate, createTray };
