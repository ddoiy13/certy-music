# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Windows Electron app wrapping `music.youtube.com`. It includes global shortcuts (play/pause, next, previous), the Better Lyrics extension, and Discord "Listening to" activity. User-facing text is written in Korean. This is a git repository (remote: `ddoiy13/certy-music`). Designs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Commands

- `npm start`: run in development
- `npm test`: `node --test test/*.test.js`. For a single file: `node --test test/settings.test.js`
- `npm run dist`: build the NSIS installer (`dist/Certy Music Setup.exe`)
- Debugging: start with `YTM_DEBUG_PORT=9222 npm start` (ignored in packaged builds), then evaluate JS in the running page with `node scripts/cdp.js "<JS expression>"`. `node scripts/cdp.js --targets` prints the list of targets.

## Structure

- `src/main.js`: window creation, global shortcut registration, IPC handlers, external link guard. The logic is split out into pure modules.
  - `settings.js`: loads/saves `userData/settings.json` and validates shortcuts, window bounds, and the `discord` toggle (default on). A corrupted file is recovered with defaults.
  - `shortcuts.js`: wrapper around `globalShortcut`. Media keys are fixed; only user-defined shortcuts can be changed.
  - `player.js`: controls playback by clicking player bar buttons via `executeJavaScript`. All YouTube Music DOM selectors are kept in one place, `SELECTORS`.
  - `presence.js`: Discord Rich Presence via `@xhayper/discord-rpc`. `main.js` polls `player.readTrack` every 3 seconds and sends the track as a "Listening" activity. It does not affect the app when Discord is closed and reconnects every 15 seconds. `buildActivity` and `sameActivity` are pure functions; the client is injectable for tests. The toggle lives in the app settings tab (`settings:setDiscord`). `CLIENT_ID` is a Discord application ID, which is not a secret.
  - `extension.js`: loads `extensions/better-lyrics/` into the same session and opens its options window.
  - `updater.js`: wrapper around `electron-updater` for GitHub Releases updates. `createUpdater` takes an injectable `autoUpdater` (null in development runs, so nothing is checked) and keeps a status object (`idle/checking/available/downloading/ready/uptodate/error` plus `downgrade`). `main.js` checks 10 seconds after start and every 6 hours, pushes `update:state` to the settings tab, and shows a notification once per version (never for downgrades). The settings tab has the "빌드 버전" (Stable / Pre-Release) select and the auto-update toggle (`settings:setUpdateChannel`, `settings:setAutoUpdate`). Auto-update is off by default and installs on quit; the install button downloads and restarts immediately. **Downgrades are always manual**, even with auto-update on: `autoDownload` stays `false` and `updater.js` downloads only upgrades itself.
- `src/preload.js`: injects an "앱 설정" (App Settings) tab into the YouTube Music settings screen. It manipulates the DOM directly in the isolated world and does not use `contextBridge`. Selectors for the settings screen are kept in the `SEL` object.
- `test/`: tests only the pure modules (`settings`, `shortcuts`, `player`, `presence`). `main.js` and `preload.js` are verified by running the app.

## Constraints to Follow

- **Session**: the window and the extension both use the `persist:ytmusic` partition. Any new window must use the same session so that login and the extension are shared.
- **IPC trust**: `trusted()` in `main.js` only allows IPC coming from the main frame of `music.youtube.com`. Any new handler must also go through this check.
- **Navigation guard**: applied to every webContents in `web-contents-created`. `https` links outside YouTube/Google are sent to `shell.openExternal`; all other protocols are blocked.
- **Trusted Types**: `innerHTML` cannot be used on YouTube pages. `preload.js` uses only `createElement`, `textContent`, and `element.style`.
- **User-Agent**: keep the default. Removing the `Electron` token blocks Google login.
- **Login redirect**: when a logged-out session is redirected to `/premium` or `/musicpremium`, `will-redirect` sends it to the Google login URL exactly once. The `loginRedirected` flag prevents an infinite loop.
- **Cookie encryption**: packaged builds enable the `enableCookieEncryption` fuse. Development runs use a separate `userData` directory, `yt-music-electron-dev`, because an electron binary without the fuse corrupts the packaged app's cookie store if it touches it. Do not remove this separation code.
- **Extension**: `extensions/better-lyrics/` is a snapshot (2.4.1) of the official Chrome build. It has no auto-update and is packaged outside the asar via `extraResources`. Some behavior needs to be verified empirically in Electron (e.g., the MV3 service worker). The only local changes are for `electron-shim.js`, which fills in `chrome.*` APIs missing in Electron: the shim file itself, a content script entry at the top of `manifest.json`, an `import` on the first line of `background/service_worker.js`, and a `<script>` tag right after `<head>` in the 6 HTML pages (`action`, `options`, `pages/*`). Re-apply these when replacing the snapshot.
- **Release procedure**: bump `version` in `package.json` → `npm run dist` → upload `CertyMusic-Setup.exe`, its `.blockmap`, and `latest.yml` from `dist/` to a GitHub Release (tag must be valid semver, e.g. `v1.2.0-beta.1`). Mark pre-release builds as "Pre-release" on GitHub (use a version like `1.2.0-beta.1`, which is lower than `1.2.0`). The build writes `latest.yml` even for pre-release versions (verified with electron-builder 26.15.3). The Pre-Release setting only toggles `allowPrerelease`; do not set `autoUpdater.channel` (it forces `allowDowngrade` and breaks pre-release selection in `GitHubProvider`) and do not set `build.publish.channel` (it is baked into `app-update.yml` as the installed app's default channel, so switching to Stable would look for `beta.yml` in the stable release). Never build with `--publish always`; releases are uploaded by hand. The packaged installer is not code-signed, so integrity relies only on the hash in `latest.yml`.
