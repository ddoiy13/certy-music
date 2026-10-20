const fs = require('node:fs');
const path = require('node:path');

const ACTIONS = ['playPause', 'next', 'prev'];
const DEFAULT_SHORTCUTS = Object.freeze({
  playPause: 'Ctrl+Alt+Space',
  next: 'Ctrl+Alt+Right',
  prev: 'Ctrl+Alt+Left',
});
const DEFAULT_WINDOW = Object.freeze({ width: 1280, height: 800 });
const CHANNELS = Object.freeze(['stable', 'prerelease']);
const { LANGUAGES } = require('./i18n');

const MODIFIER_ALIASES = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super' };
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
const NAMED_KEYS = [
  'Space', 'Up', 'Down', 'Left', 'Right', 'Enter', 'Tab', 'Backspace',
  'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
];

const PUNCTUATION_KEYS = ['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'];

function resolveKey(key) {
  if (PUNCTUATION_KEYS.includes(key)) return key;
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
    return { ok: false, reason: 'error.shortcutNeedsModifier' };
  }
  if (others.map(normalizeAccelerator).includes(norm)) {
    return { ok: false, reason: 'error.shortcutDuplicate' };
  }
  return { ok: true, accelerator: norm };
}

function loadShortcuts(raw) {
  // First, check if there are duplicates in the input
  const inputShortcuts = raw?.shortcuts || {};
  const inputValues = [];
  for (const action of ACTIONS) {
    const val = inputShortcuts[action];
    const norm = normalizeAccelerator(val);
    if (norm) {
      if (inputValues.includes(norm)) {
        // Duplicate found in input
        return { ...DEFAULT_SHORTCUTS };
      }
      inputValues.push(norm);
    }
  }

  // No duplicates in input, validate each one
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
  return {
    shortcuts: loadShortcuts(raw),
    window: loadWindow(raw),
    discord: raw.discord !== false,
    autoUpdate: raw.autoUpdate === true,
    updateChannel: raw.updateChannel === 'prerelease' ? 'prerelease' : 'stable',
    language: LANGUAGES.includes(raw.language) ? raw.language : 'auto',
  };
}

function save(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { ACTIONS, CHANNELS, LANGUAGES, DEFAULT_SHORTCUTS, validateAccelerator, load, save };
