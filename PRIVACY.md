# Privacy Policy

Last updated: 2026-10-23

Certy Music is an independent, unofficial Windows desktop app that wraps YouTube Music. This policy explains what data the app handles and where it goes.

## Summary

- The app itself has no analytics, telemetry, or crash reporting, and the developer runs no server that receives your data.
- Your Google login session is handled by YouTube Music and Google, and is stored only on your PC.
- Some features send limited information to third parties (Discord, GitHub, and the bundled Better Lyrics extension's lyrics services). Details are below.

## Data stored on your PC

The following data stays on your PC in the app's data folder (`%APPDATA%`) and is not sent to the developer.

- **Login session (cookies).** Created when you sign in to Google/YouTube Music. In packaged builds the cookie store is encrypted with Windows DPAPI, which protects it from other Windows accounts and from copying the files to another PC, but not from software running under your own Windows account. See "Security Warning" in the [README](README.md).
- **App settings.** Shortcut keys, window size and position, language, update channel, auto-update, and Discord on/off.
- **Better Lyrics settings.** Stored in the bundled extension's local storage.

Uninstalling the app does not necessarily remove the data folder. Delete it manually if you want it gone.

## Data sent to third parties

### Google / YouTube

The app loads `music.youtube.com` and uses Google sign-in. Your listening, account, and device data is handled by Google under [Google's Privacy Policy](https://policies.google.com/privacy).

### Discord Rich Presence

When Discord Rich Presence is on (it is on by default; you can turn it off in the app's settings tab), the app passes the following to your local Discord client:

- the track title, artist, and album
- the album art URL
- whether playback is paused, and playback timestamps while playing

Discord then shows this on your Discord profile, which other people may see depending on your Discord privacy settings. The app does not send this data to any server of its own. Discord's handling is covered by [Discord's Privacy Policy](https://discord.com/privacy).

### Updates (GitHub)

The app checks GitHub Releases for new versions (shortly after start and every 6 hours) and downloads installers from there. GitHub receives the usual connection information, such as your IP address and the app version, under [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

### Better Lyrics extension (third-party services)

The app bundles the [Better Lyrics](https://github.com/better-lyrics/better-lyrics) extension to show synced lyrics. To fetch lyrics, the extension contacts third-party services, which include:

- LRCLIB (`lrclib.net`)
- Better Lyrics services (`betterlyrics.org`, including its Unison lyrics service and mirrors)
- `lyrics.api.dacubeking.com`
- Google Translate (`translate.googleapis.com`), only when you use its translation/romanization features. The lyric text being translated is sent to Google.

These requests include information about the track you are playing so that matching lyrics can be found. The exact fields are decided by the extension and its services, not by this app. Each service has its own privacy practices, which the developer of Certy Music does not control. If you do not want any of this, disable the extension's lyrics sources in its options, or do not use the lyrics feature.

## What the developer collects

Nothing. The developer of Certy Music does not receive, store, or process your personal data. The developer can see only the aggregate download statistics that GitHub shows for releases.

## Children

The app is not directed at children. Use of YouTube Music is subject to Google's age requirements.

## Changes

If this policy changes, the new version will be published in this repository with an updated date.

## Contact

Open an issue at <https://github.com/ddoiy13/certy-music/issues>.
