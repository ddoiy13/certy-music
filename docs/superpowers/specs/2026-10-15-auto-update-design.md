# GitHub 릴리스 업데이트 기능 설계

## 목적

`ddoiy13/certy-music`(public)의 GitHub Releases에 올라온 새 설치 파일을 앱이 확인하고, 사용자가 버튼으로 설치하거나 자동 업데이트를 켜 두면 알아서 내려받아 설치한다.

## 요구사항

- 새 버전이 있으면 Windows 알림을 띄운다 (새 버전을 처음 발견했을 때 한 번).
- 앱 설정 탭에 현재 버전, 업데이트 상태, **[업데이트 확인]**, **[업데이트 설치]** 버튼, **자동 업데이트** 체크박스를 둔다.
- **[업데이트 설치]**: 설치 파일을 내려받고(진행률 표시) 다 받으면 앱을 재시작하며 설치한다.
- **자동 업데이트 ON**: 버튼 없이 백그라운드에서 내려받고, 앱을 **종료할 때** 설치한다. 재생 중 갑작스러운 재시작을 피하기 위함이다.
- **자동 업데이트 기본값은 OFF**. 알림은 OFF여도 뜬다.
- **빌드 버전(채널) 선택**: 업데이트 섹션에서 **Stable** / **Pre-Release** 중 고른다. 기본값은 Stable.
  - Stable: GitHub에서 Pre-release로 표시되지 않은 릴리스만 대상으로 한다.
  - Pre-Release: Pre-release로 표시된 릴리스도 대상으로 한다 (Stable보다 새 버전이면 그쪽을 받는다).
  - 채널을 바꾸면 즉시 업데이트를 다시 확인한다.
  - Pre-Release에서 Stable로 되돌릴 때, 현재 설치된 버전이 프리릴리스 버전이고 Stable이 더 낮은 버전이면 그 Stable로 다운그레이드를 허용한다.
  - **다운그레이드는 자동 업데이트가 켜져 있어도 항상 수동이다.** 자동으로 내려받거나 종료 시 설치하지 않고, 알림도 띄우지 않는다. 설정 탭에 "이전 버전 vX.Y.Z으로 되돌릴 수 있습니다. 자동으로 설치되지 않습니다."와 [vX.Y.Z으로 되돌리기] 버튼을 보여주고, 사용자가 누르면 내려받아 설치한다. 이를 위해 `electron-updater`의 `autoDownload`는 항상 꺼 두고, `updater.js`가 `update-available`에서 버전 비교(`semver`) 후 업그레이드만 직접 내려받는다.
- 확인 주기: 시작 10초 후, 이후 6시간마다.
- 개발 실행(`!app.isPackaged`)에서는 확인하지 않는다.

## 비목표

- 코드 서명, 델타 업데이트 최적화, 릴리스 노트 표시.
- Stable/Pre-Release 외의 추가 채널(alpha, nightly 등).
- 릴리스 자동 발행. 릴리스는 사용자가 직접 올린다.

## 구성

### `src/updater.js` (신규)

`electron-updater`의 `autoUpdater`를 감싼다. `presence.js`처럼 `autoUpdater`를 주입할 수 있어 단위 테스트가 가능하다.

- 상태: `idle | checking | available | downloading | ready | uptodate | error`
- 상태 객체: `{ status, version, percent, error, downgrade }`. `downgrade`는 발견된 버전이 설치된 버전보다 낮을 때 `true`다. 상태가 바뀔 때마다 `onState(state)` 콜백을 호출한다.
- API
  - `check({ manual })`: 확인한다. `manual`이 아니면 실패를 상태에 반영하지 않고 조용히 `idle`로 돌아간다.
  - `install()`: `available`이면 다운로드를 시작하고, `ready`가 되면 `quitAndInstall`을 호출한다.
  - `setAutoUpdate(on)`: `autoInstallOnAppQuit`을 설정한다 (`autoDownload`는 항상 `false`). 자동 모드에서는 **업그레이드만** 발견 즉시 직접 내려받고 종료 시 설치한다. 다운그레이드는 자동 모드에서도 내려받지 않는다.
  - `setChannel('stable' | 'prerelease')`: `allowPrerelease`와 `allowDowngrade`를 설정한다 (`prerelease`일 때 `allowPrerelease = true`). 다운그레이드는 위 요구사항의 조건에서만 허용한다.
  - `getState()`
- `autoDownload`는 기본 `false`이고 자동 모드에서만 `true`다.
- 확인 주기 타이머는 `main.js`가 관리한다.

### `src/settings.js`

- `autoUpdate`를 추가한다. `raw.autoUpdate === true`일 때만 `true`다 (기본 `false`, 손상된 값은 `false`).
- 기존 `discord`와 같은 방식으로 로드/저장한다.
- `updateChannel`을 추가한다. `'stable'` 또는 `'prerelease'`만 허용하고, 그 외의 값이나 없는 값은 `'stable'`이다.

### `src/main.js`

- 앱 준비 후 `updater`를 만들고 `settings.autoUpdate`를 적용한다. 시작 10초 후와 6시간마다 `check({ manual: false })`를 호출한다.
- IPC (모두 기존 `trusted()` 검사를 거친다)
  - `update:check` → `check({ manual: true })`
  - `update:install` → `install()`
  - `settings:setAutoUpdate(on)` → boolean 검증, 저장 실패 시 롤백 (`settings:setDiscord`와 동일한 패턴)
  - `settings:setUpdateChannel(channel)` → `'stable'`/`'prerelease'` 검증, 저장 실패 시 롤백, 성공하면 `updater.setChannel` 후 `check({ manual: true })`
- `settings:get` 응답에 `version`(`app.getVersion()`), `autoUpdate`, `updateChannel`, `update`(현재 상태)를 추가한다.
- 상태가 바뀌면 `win.webContents.send('update:state', state)`로 푸시한다.
- 상태가 `available`로 처음 바뀔 때(버전당 한 번) Electron `Notification`을 띄운다.
- `will-quit`에서 확인 타이머를 정리한다.

### `src/preload.js`

- 앱 설정 패널에 "업데이트" 섹션을 추가한다: 버전, 빌드 버전 선택(Stable / Pre-Release), 상태 문구, [업데이트 확인], [업데이트 설치], 자동 업데이트 체크박스.
- 빌드 버전 선택은 `<select>` 하나로 만들고, 변경에 실패하면 이전 값으로 되돌린다.
- `ipcRenderer.on('update:state', ...)`로 상태 문구와 진행률을 갱신한다. 패널이 닫혀 있으면 무시한다.
- Trusted Types 제약에 따라 기존 `h()`(`createElement`, `textContent`, `style`)만 사용한다.

### `package.json`

- `dependencies`에 `electron-updater`를 추가한다.
- `build.publish`를 `{ provider: "github", owner: "ddoiy13", repo: "certy-music" }`로 설정한다. `channel`은 지정하지 않는다 (아래 운영상 유의점 참고). `npm run dist`가 `latest.yml`을 함께 만든다.
- `scripts.dist`는 `electron-builder --win nsis --publish never`로 한다. 릴리스는 사용자가 직접 올리므로 빌드가 GitHub에 자동 업로드하면 안 된다 (`--publish always` 금지).

## 에러 처리

- 백그라운드 확인 실패(오프라인 등)는 조용히 무시한다.
- 수동 확인이나 설치 중 실패는 `error` 상태와 사유를 설정 탭에 표시한다.
- 설정 저장 실패는 `settings:setDiscord`처럼 롤백하고 `{ ok: false, reason }`을 반환한다.

## 테스트

- `test/updater.test.js`: 가짜 `autoUpdater`로 상태 전이, 자동/수동 모드 분기, 조용한 실패, `install()`의 다운로드 후 설치 흐름을 검증한다.
- `test/updater.test.js`에는 `setChannel`이 `allowPrerelease`/`allowDowngrade`를 올바르게 설정하는지도 포함한다.
- `test/settings.test.js`: `autoUpdate`, `updateChannel`의 기본값과 손상된 값 복구를 추가한다.
- `main.js`/`preload.js`는 기존 방식대로 앱을 실행해 확인한다.
- 실제 end-to-end는 릴리스 두 개(예: 업데이트 기능이 들어간 1.0.1을 설치한 뒤 1.0.2 발행)가 있어야 확인할 수 있다.

## 운영상 유의점

1. 이미 설치된 1.0.0에는 업데이트 코드가 없으므로, 이 기능이 들어간 첫 버전은 직접 설치해야 한다.
2. 릴리스 절차: `package.json`의 `version` 상승 → `npm run dist` → GitHub Release에 `CertyMusic-Setup.exe`, `.blockmap`, `latest.yml` 업로드. 이 절차를 CLAUDE.md에 기록한다.
   - Pre-Release 빌드는 `1.2.0-beta.1`처럼 버전에 프리릴리스 태그를 붙이고, GitHub에서 릴리스를 **Pre-release**로 표시해 올린다. 빌드는 프리릴리스 버전이어도 `latest.yml`을 만든다 (electron-builder 26.15.3으로 확인). 앱 쪽은 `electron-updater` 6.8.9 소스 기준으로, Stable은 `/releases/latest`(정식 릴리스)를, Pre-Release는 releases atom 피드의 첫 항목을 고르고 `beta.yml`이 없으면 `latest.yml`로 폴백한다. `autoUpdater.channel`은 설정하지 않는다 (설정하면 `allowDowngrade`가 자동으로 켜지고 프리릴리스 선택이 막힌다). 구현 단계에서 설치된 버전으로 다시 확인한다.
   - **`build.publish.channel`도 지정하지 않는다.** `channel: "beta"`를 주면 `beta.yml`이 만들어지지만, 그 값이 빌드에 포함되는 `app-update.yml`에 박혀 설치된 앱의 기본 채널이 된다 (`electron-updater`는 `updater.channel || options.channel`을 읽는다). 이 빌드를 설치한 사용자가 Stable로 바꾸면 정식 릴리스에서 `beta.yml`을 찾다가 404가 나고, `allowPrerelease`가 꺼져 있으면 `latest.yml`로 폴백하지 않는다 (소스 기준 추론이며 실행 확인은 하지 않았다). GitHub Releases는 릴리스마다 파일이 따로 올라가므로 파일명이 `latest.yml`로 같아도 충돌하지 않는다.
   - 릴리스 **태그**는 `v1.2.0-beta.1`처럼 유효한 semver여야 한다. 피드 경로가 `semver.valid(tag)`를 요구해서 그렇지 않은 태그는 건너뛴다.
   - 버전 번호는 semver 순서를 따른다. `1.0.0-beta.1`은 `1.0.0`보다 **낮다**. 이미 올라간 정식 버전보다 높은 번호로 올린다 (예: `1.0.1-beta.1`).
3. 코드 서명이 없어 무결성 검증은 `latest.yml`의 해시뿐이다. 저장소 릴리스 쓰기 권한이 곧 신뢰 기준이다.
