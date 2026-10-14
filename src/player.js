// YouTube Music DOM이 바뀌면 여기만 고친다. (Task 3 Step 6에서 실제 DOM으로 확인)
const SELECTORS = Object.freeze({
  playPause: 'ytmusic-player-bar #play-pause-button',
  next: 'ytmusic-player-bar .next-button',
  prev: 'ytmusic-player-bar .previous-button',
});

function clickScript(selector) {
  return `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return false; b.click(); return true; })()`;
}

async function control(webContents, action) {
  const selector = SELECTORS[action];
  if (!selector) return false;
  try {
    return (await webContents.executeJavaScript(clickScript(selector))) === true;
  } catch {
    return false;
  }
}

// 곡 정보 셀렉터. 바뀌면 여기만 고친다.
const TRACK_SELECTORS = Object.freeze({
  bar: 'ytmusic-player-bar',
  title: 'ytmusic-player-bar .title',
  byline: 'ytmusic-player-bar .byline',
  art: 'ytmusic-player-bar img.image',
  video: 'video',
});

const TRACK_SCRIPT = `(() => {
  const S = ${JSON.stringify(TRACK_SELECTORS)};
  if (!document.querySelector(S.bar)) return null;
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
  const v = document.querySelector(S.video);
  const art = document.querySelector(S.art)?.src || '';
  return {
    title: text(S.title),
    byline: text(S.byline),
    art,
    playing: !!v && !v.paused && !v.ended,
    position: v ? v.currentTime : 0,
    duration: v ? v.duration : 0,
  };
})()`;

// 플레이어 바의 byline은 "아티스트 • 앨범 • 연도" 형태다.
function parseTrack(raw) {
  if (!raw || typeof raw.title !== 'string' || !raw.title) return null;
  const parts = String(raw.byline || '').split('•').map((s) => s.trim()).filter(Boolean);
  // 앨범아트 URL은 작은 썸네일이므로 큰 크기로 바꾼다 (googleusercontent는 =w60-h60 형태).
  const art = typeof raw.art === 'string' ? raw.art.replace(/=w\d+-h\d+[^/]*$/, '=w512-h512') : '';
  return {
    title: raw.title,
    artist: parts[0] || '',
    album: parts[1] || '',
    art,
    playing: raw.playing === true,
    position: Number(raw.position),
    duration: Number(raw.duration),
  };
}

async function readTrack(webContents) {
  try {
    return parseTrack(await webContents.executeJavaScript(TRACK_SCRIPT));
  } catch {
    return null;
  }
}

module.exports = { SELECTORS, TRACK_SELECTORS, control, parseTrack, readTrack };
