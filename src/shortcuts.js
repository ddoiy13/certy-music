const { ACTIONS } = require('./settings');

const MEDIA_KEYS = Object.freeze({
  playPause: 'MediaPlayPause',
  next: 'MediaNextTrack',
  prev: 'MediaPreviousTrack',
});

// Media keys are deliberately not registered: even attempting globalShortcut.register on one
// makes Electron drop its SMTC session. Left alone, they reach the page through SMTC.
function createShortcutManager(globalShortcut, handlers) {
  const custom = {};

  function applyAll(shortcuts) {
    const failed = [];
    for (const action of ACTIONS) {
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
