const { ipcRenderer } = require('electron');

const TAB_ID = 'app-settings-tab';
const PANEL_ID = 'app-settings-panel';
const LABELS = { playPause: '재생 / 일시정지', next: '다음 곡', prev: '이전 곡' };

// YouTube Music 설정 화면 DOM. 라이브 설정 페이지에서 실측한 값이다. 바뀌면 여기만 고친다.
const SEL = {
  page: 'ytmusic-settings-page',
  tabList: 'tp-yt-paper-listbox.category-menu',
  tabItem: 'tp-yt-paper-item.category-menu-item',
  tabLabel: 'yt-formatted-string.title',
  content: 'ytmusic-setting-category-collection-renderer',
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
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
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
  if (result && result.ok) {
    btn.textContent = result.shortcuts[action];
    err.textContent = '';
  } else {
    btn.textContent = fallbackText;
    err.textContent = (result && result.reason) || '요청에 실패했습니다.';
  }
}

async function invokeSafe(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch {
    return { ok: false, reason: '요청에 실패했습니다.' };
  }
}

let recording = null;
function record(action, btn, err) {
  if (recording === btn) return;
  recording = btn;
  const prev = btn.textContent;
  btn.textContent = '키를 누르세요… (Esc 취소)';
  err.textContent = '';
  function cleanup() {
    if (recording === btn) recording = null;
    window.removeEventListener('keydown', onKey, true);
    btn.removeEventListener('blur', onBlur);
  }
  async function onKey(e) {
    if (e.isTrusted !== true) return;
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
    showResult(await invokeSafe('settings:setShortcut', action, acc), action, btn, err, prev);
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
  btn.addEventListener('click', (e) => {
    if (e.isTrusted !== true) return;
    record(action, btn, err);
  });
  reset.addEventListener('click', async (e) => {
    if (e.isTrusted !== true) return;
    const prev = btn.textContent;
    showResult(await invokeSafe('settings:resetShortcut', action), action, btn, err, prev);
  });
  return row;
}

function discordRow(state) {
  const row = h('label', { display: 'flex', alignItems: 'center', gap: '12px', margin: '8px 0 16px', cursor: 'pointer' });
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!state.discord;
  Object.assign(box.style, { width: '16px', height: '16px', cursor: 'pointer' });
  const err = h('span', { color: '#ff6b6b', fontSize: '12px' });
  row.append(box, h('span', {}, 'Discord 활동으로 지금 듣는 곡 표시'), err);
  box.addEventListener('change', async (e) => {
    if (e.isTrusted !== true) return;
    const want = box.checked;
    const r = await invokeSafe('settings:setDiscord', want);
    if (r && r.ok) {
      err.textContent = '';
    } else {
      box.checked = !want;
      err.textContent = (r && r.reason) || '요청에 실패했습니다.';
    }
  });
  return row;
}

async function renderPanel() {
  let state = null;
  try {
    state = await ipcRenderer.invoke('settings:get');
  } catch {
    state = null;
  }
  if (!state) return null;
  const panel = h('div', { padding: '24px 32px', color: '#fff', font: '14px/1.5 Roboto, sans-serif', maxWidth: '640px', flex: '1 1 auto', minWidth: '0' });
  panel.id = PANEL_ID;
  panel.appendChild(h('h2', { margin: '0 0 8px', font: '500 20px Roboto, sans-serif' }, '앱 설정'));
  panel.appendChild(
    h('p', { margin: '0 0 24px', opacity: '0.7' },
      `미디어 키(${Object.values(state.mediaKeys).join(', ')})는 항상 함께 동작합니다.`),
  );
  for (const action of Object.keys(LABELS)) panel.appendChild(shortcutRow(action, state));
  panel.appendChild(discordRow(state));
  if (state.betterLyrics) {
    const open = h('button', { ...BTN, marginTop: '16px' }, 'Better Lyrics 설정 열기');
    open.addEventListener('click', (e) => {
      if (e.isTrusted !== true) return;
      ipcRenderer.invoke('bl:openOptions').catch(() => {});
    });
    panel.appendChild(open);
  }
  return panel;
}

let panelShown = false;
let prevSelected = null;

function setSelected(el, on) {
  el.classList.toggle('iron-selected', on);
  if (on) {
    el.setAttribute('iron-selected', '');
    el.setAttribute('aria-selected', 'true');
  } else {
    el.removeAttribute('iron-selected');
    el.removeAttribute('aria-selected');
  }
}

function hidePanel(page, clickedItem) {
  if (!panelShown) return;
  panelShown = false;
  document.getElementById(PANEL_ID)?.remove();
  const content = page.querySelector(SEL.content);
  if (content) content.style.display = '';
  const tab = document.getElementById(TAB_ID);
  if (tab) setSelected(tab, false);
  // 이전에 선택돼 있던 탭을 다시 누르면 리스트박스의 선택이 바뀌지 않아 직접 복원한다.
  if (clickedItem && clickedItem === prevSelected) setSelected(prevSelected, true);
  prevSelected = null;
}

async function showPanel(page) {
  const content = page.querySelector(SEL.content);
  const tab = document.getElementById(TAB_ID);
  const list = tab && tab.parentElement;
  if (!content || !list) return;
  const panel = await renderPanel();
  if (!panel) return;
  document.getElementById(PANEL_ID)?.remove();
  if (!panelShown) {
    prevSelected = [...list.querySelectorAll(SEL.tabItem)].find(
      (i) => i !== tab && (i.classList.contains('iron-selected') || i.hasAttribute('iron-selected')),
    ) || null;
  }
  for (const item of list.querySelectorAll(SEL.tabItem)) if (item !== tab) setSelected(item, false);
  setSelected(tab, true);
  panelShown = true;
  // 숨기기 전에 콘텐츠 영역의 구분선/높이를 읽어 패널에 옮긴다.
  const cs = getComputedStyle(content);
  const h0 = content.offsetHeight;
  Object.assign(panel.style, { borderLeft: cs.borderLeft, boxSizing: 'border-box', alignSelf: 'stretch' });
  if (h0 > 0) panel.style.minHeight = h0 + 'px';
  content.style.display = 'none';
  content.insertAdjacentElement('afterend', panel);
}

function ensureTab() {
  const page = document.querySelector(SEL.page);
  if (!page) return;
  const list = page.querySelector(SEL.tabList);
  const sample = list && (list.querySelector(`${SEL.tabItem}:not(.iron-selected):not([iron-selected])`) || list.querySelector(SEL.tabItem));
  if (!sample || list.querySelector(`#${TAB_ID}`)) return;

  const sampleTitle = sample.querySelector(SEL.tabLabel);
  const sampleIcon = sample.querySelector('yt-icon.icon');
  const tab = sample.cloneNode(true);
  tab.id = TAB_ID;
  tab.classList.remove('iron-selected');
  for (const a of ['iron-selected', 'aria-selected', 'selected']) tab.removeAttribute(a);

  // 복제된 커스텀 엘리먼트는 재초기화되어 비므로 일반 DOM으로 교체한다.
  const cloneTitle = tab.querySelector(SEL.tabLabel);
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = '앱 설정';
  if (sampleTitle) {
    const cs = getComputedStyle(sampleTitle);
    Object.assign(title.style, { font: cs.font, color: cs.color, flex: '1 1 auto' });
  }
  if (cloneTitle) cloneTitle.replaceWith(title);
  else tab.prepend(title);

  const cloneIcon = tab.querySelector('yt-icon.icon');
  const iconShape = sampleIcon && sampleIcon.firstElementChild;
  if (cloneIcon) {
    if (iconShape) {
      const icon = document.createElement('div');
      icon.className = sampleIcon.className;
      icon.appendChild(iconShape.cloneNode(true));
      cloneIcon.replaceWith(icon);
    } else {
      cloneIcon.remove();
    }
  }

  const activate = (e) => {
    if (e.isTrusted !== true) return;
    e.preventDefault();
    e.stopPropagation();
    showPanel(page);
  };
  tab.addEventListener('click', activate, true);
  tab.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate(e);
    },
    true,
  );
  list.appendChild(tab);

  if (!list.__appSettingsBound) {
    list.__appSettingsBound = true;
    list.addEventListener(
      'click',
      (e) => {
        if (!e.target.closest(`#${TAB_ID}`)) hidePanel(page, e.target.closest(SEL.tabItem));
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
