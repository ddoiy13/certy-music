# Certy Music
An unofficial desktop app for YouTube Music that includes the "Better Lyrics" extension

<p align="left">
 <a aria-label="License" href="https://www.gnu.org/licenses/gpl-3.0.en.html"><img src="https://img.shields.io/badge/license-GPL_v3-blue.svg" alt=""/></a>
</p>

## Introduction
An unofficial Windows desktop app that wraps YouTube Music in Electron. It adds global media shortcuts (play/pause, next, previous), bundles the Better Lyrics extension for time-synced lyrics, and shows what you're listening to as a Discord activity.
- Currently, the app’s UI is available only in Korean and English. Other languages are not supported yet.

## Download
1. Download from the [Release](https://github.com/ddoiy13/certy-music/releases) page.
2. Install it, then log in to use it.

## Security Warning
Login cookies are not protected strongly enough. If someone gets access to your PC, your user profile, or the app's data folder, your login session may be stolen and used to access your Google account. For this and other reasons, problems such as account restrictions or suspension may occur. Use this app at your own risk.

## Disclaimer
This is an independent, non-commercial, unofficial project. Warranty and liability are covered by sections 15 and 16 of the [GPL-3.0](LICENSE) license. In addition, the author is not responsible for account restrictions or suspension caused by using this app. Use of YouTube Music through this app remains subject to [YouTube's Terms of Service](https://www.youtube.com/t/terms), which you are responsible for following.

## Changes to Better Lyrics
The bundled extension in `extensions/better-lyrics/` is the official Better Lyrics 3.0.0 Chrome build. Electron implements only part of the Chrome extension API, so the following changes were made. Nothing else was modified.

- **Added `electron-shim.js`**: fills in the `chrome.*` APIs that Electron is missing or breaks.
  - `chrome.windows.onRemoved`: added as a no-op event.
  - `chrome.storage.sync`: Electron's native sync area throws, so it is replaced with a wrapper backed by `chrome.storage.local`, including `onChanged` forwarding.
- **Load the shim**:
  - `manifest.json`: added a content script entry for `electron-shim.js` at the top of `content_scripts` (`music.youtube.com`, `document_start`). The file is also re-indented.
  - `background/service_worker.js`: added `import '../electron-shim.js';` as the first line.
  - `action/index.html`, `options/index.html`, `pages/{auth,marketplace,standalone-editor,unison}.html`: added `<script src="/electron-shim.js"></script>` right after `<head>`.

## AI Disclosure
Most of the code in this project was written by AI (Claude, by Anthropic). The bundled Better Lyrics extension is the work of its original authors and is not covered by this statement, apart from the changes listed above. Since the code was largely AI-generated, it may contain bugs or security issues.


## Trademarks
YouTube and YouTube Music are trademarks of Google LLC. Use of these trademarks is subject to Google's guidelines. This project is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.
Discord is a trademark of Discord Inc.

## Reference
[Better Lyrics](https://github.com/better-lyrics/better-lyrics)
