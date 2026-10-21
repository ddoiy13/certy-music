// Re-applies the local Electron changes after replacing extensions/better-lyrics/
// with a fresh official build. Safe to run more than once.
// Usage: node scripts/apply-better-lyrics-shim.js
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extensions', 'better-lyrics');
const SHIM_SRC = path.join(__dirname, 'better-lyrics', 'electron-shim.js');
const SHIM_TAG = '<script src="/electron-shim.js"></script>';
const SW_IMPORT = "import '../electron-shim.js';";
const SHIM_ENTRY = {
  js: ['electron-shim.js'],
  matches: ['*://music.youtube.com/*'],
  run_at: 'document_start',
  world: 'ISOLATED',
  all_frames: true,
};

const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(EXT, p).split(path.sep).join('/');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

if (!fs.existsSync(path.join(EXT, 'manifest.json'))) {
  console.error('extensions/better-lyrics/manifest.json not found. Put the official build there first.');
  process.exit(1);
}

// 1. Shim file
fs.copyFileSync(SHIM_SRC, path.join(EXT, 'electron-shim.js'));
console.log('shim: copied electron-shim.js');

// 2. manifest.json content script entry (first in the list)
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(read(manifestPath));
const scripts = (manifest.content_scripts ||= []);
if (scripts.some((s) => (s.js || []).includes('electron-shim.js'))) {
  console.log('manifest: already has shim entry');
} else {
  scripts.unshift(SHIM_ENTRY);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('manifest: added shim content script');
}

// 3. Service worker import on line 1
const swPath = path.join(EXT, 'background', 'service_worker.js');
if (!fs.existsSync(swPath)) {
  console.warn('service worker: background/service_worker.js not found, skipped');
} else {
  const sw = read(swPath);
  if (sw.startsWith(SW_IMPORT)) {
    console.log('service worker: already imports shim');
  } else {
    fs.writeFileSync(swPath, SW_IMPORT + '\n' + sw);
    console.log('service worker: added import');
  }
}

// 4. <script> right after <head> in every HTML page
const pages = walk(EXT).filter((p) => p.endsWith('.html'));
for (const p of pages) {
  const html = read(p);
  if (html.includes(SHIM_TAG)) {
    console.log(`html: ${rel(p)} already patched`);
    continue;
  }
  const next = html.replace(/<head[^>]*>/i, (m) => m + '\n' + SHIM_TAG);
  if (next === html) {
    console.warn(`html: ${rel(p)} has no <head>, SKIPPED`);
    continue;
  }
  fs.writeFileSync(p, next);
  console.log(`html: patched ${rel(p)}`);
}
console.log(`done (${pages.length} html pages found; the old build had 6)`);
