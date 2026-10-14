# YouTube Music Electron 래퍼 설계

## 목표
`music.youtube.com`을 Electron 창으로 감싼 Windows 독립 실행 앱. 전역 단축키로 재생을 제어하고, 단축키는 YouTube Music 자체 설정 화면에 주입한 "앱 설정" 탭에서 변경한다. 배포 형태는 설치가 필요 없는 포터블 단일 `.exe`.

## 범위
포함:
- 창 로드, 로그인 유지, 창 크기/위치 기억, 단일 인스턴스
- 전역 단축키 3개: 재생/일시정지, 다음 곡, 이전 곡
- YouTube Music 설정 화면의 탭 목록에 "앱 설정" 탭 주입 (단축키 변경 UI)
- electron-builder `portable` 빌드

제외 (YAGNI):
- 트레이 아이콘, 광고 차단, 콘텐츠 변형
- 단축키 외의 설정 항목 (구조만 확장 가능하게 둔다)
- 대체 설정 창 (주입이 불안정하다고 확인될 때만 별도 작업으로 추가)
- 자동 테스트 (실행하여 수동 확인)

## Better Lyrics 확장 포함
- 원본: Vivaldi에 설치된 Better Lyrics 2.4.1 (ID `effdbpeggelllpfkjppbokhmmiinhlmg`, MV3, 권한 `storage`/`alarms`, 호스트 `music.youtube.com`만).
- 방식: 확장 폴더를 프로젝트의 `extensions/better-lyrics/`로 **스냅샷 복사**하고, 시작 시 `session.loadExtension`으로 로드. 포터블 `.exe`에 함께 패키징(`extraResources`, asar 밖). 확장 자동 업데이트는 되지 않으며, 갱신하려면 폴더를 다시 복사한다.
- 확장 UI(툴바 팝업, 옵션 페이지)는 Electron에 툴바가 없어 직접 열 수 없다. "앱 설정" 탭에 **"Better Lyrics 설정 열기"** 버튼을 두고, 메인이 확장의 `options/index.html`을 별도 창으로 연다.
- 확인 필요(구현 시 실측): Electron의 확장 지원은 Chrome보다 제한적이다. MV3 서비스 워커, `world: "MAIN"` 콘텐츠 스크립트, `chrome.alarms`/`storage` 동작 여부를 실제로 가사 표시까지 테스트한다. 동작하지 않으면 원인을 보고하고 대안을 제안한다.
- 라이선스: 재배포 조건을 확인하지 못했다(복사본에 LICENSE 파일 미확인). 개인 사용 기준이며, 외부 배포 시 원저작자 라이선스를 확인해야 한다.

- 향후 후보(이번 범위 아님): 확장 자동 업데이트. `update_url`(Chrome 웹 스토어 서버)에서 CRX를 받아 교체하는 방식 또는 GitHub 릴리스 방식. 둘 다 미검증이며, 확장이 Electron에서 정상 동작하는 것이 확인된 뒤 별도 작업으로 판단한다.

## 기본 단축키
| 동작 | 기본값 |
|---|---|
| 재생/일시정지 | `MediaPlayPause`, `Ctrl+Alt+Space` |
| 다음 곡 | `MediaNextTrack`, `Ctrl+Alt+Right` |
| 이전 곡 | `MediaPreviousTrack`, `Ctrl+Alt+Left` |

미디어 키는 고정, `Ctrl+Alt+…` 조합만 사용자가 변경 가능.

## 구성
- `package.json`: electron, electron-builder, `build.win.target = portable`
- `main.js`: 창 생성, UA 정리, 외부 링크 처리, 설정 로드/저장, 전역 단축키 등록, IPC 핸들러, 플레이어 제어
- `preload.js`: `contextBridge`로 `window.appSettings`(`get`, `set`, `reset`)만 노출. `ipcRenderer`는 노출하지 않음. 이어서 `inject.js` 로직을 실행
- `inject.js`: 설정 화면 감지(MutationObserver), 탭 주입, 패널 렌더, 키 조합 기록 UI

## 동작
1. **창**: 영구 파티션 세션, `contextIsolation: true`, `nodeIntegration: false`. User-Agent는 Electron 기본값을 그대로 쓴다(UA에서 `Electron` 토큰을 지우면 구글 로그인이 차단되고, 기본 UA에서는 통과함을 실측으로 확인. Pear Desktop도 기본 UA 사용). 로그아웃 상태에서 `music.youtube.com`이 `youtube.com/musicpremium`으로 리다이렉트되면, 1회에 한해 가로채 구글 로그인 URL(`continue`=`music.youtube.com`)로 보낸다. YouTube/Google 이외 도메인 이동은 `shell.openExternal`.
2. **플레이어 제어**: `webContents.executeJavaScript`로 플레이어 바 버튼 클릭. 셀렉터는 `main.js` 상단 한 객체에 모은다. Chromium 내장 미디어 키 처리는 `disable-features=MediaSessionService`로 끈다.
3. **설정 저장**: `userData/settings.json`. 깨졌거나 없으면 기본값.
4. **단축키 변경 흐름**: 렌더러가 `set(action, accelerator)` 호출 → 메인이 검증 → 기존 해제 → 새로 등록 → 실패 시 이전 값 복구 후 오류 반환 → UI가 오류 표시.
5. **검증**: 수정자 키(Ctrl/Alt/Shift) 없는 일반 키 거부, 동작 간 중복 거부, `register` 실패(타 앱 선점) 시 오류.
6. **설정 탭 주입**: 설정 화면의 탭 목록에 항목 추가, 클릭 시 기존 패널 대신 우리 패널 표시. 정확한 DOM 구조는 구현 단계에서 실제 페이지로 확인해 맞춘다.

## 알려진 위험
- Better Lyrics가 Electron에서 일부 또는 전부 동작하지 않을 수 있음(위 "확인 필요"). Better Lyrics가 YouTube Music DOM/CSS를 크게 바꾸므로 설정 탭 주입, 단축키 버튼 셀렉터와 충돌할 수 있음.
- 구글이 Electron/임베디드 브라우저의 로그인을 막을 수 있음. 구현 후 실제 로그인으로 확인하고 결과를 보고한다. 장기 보장 불가.
- 버튼 클릭 제어와 설정 탭 주입은 YouTube Music DOM 변경 시 깨질 수 있음.
- 서명 없는 `.exe`는 SmartScreen 경고 가능.
- 창을 닫으면 앱과 단축키가 종료됨(최소화 상태에서는 동작).
- 로그아웃 상태에서는 설정 화면이 열리지 않을 수 있음(허용됨).

## 검증 방법
`npm start`로 실행하여: 로그인 가능 여부, 재생, 단축키 3종, 설정 탭 표시, 단축키 변경/오류 처리, 재시작 후 설정 유지를 확인. 이후 `npm run dist`로 포터블 `.exe` 생성과 실행 확인.
