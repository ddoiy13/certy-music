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
  progress: 'ytmusic-player-bar #progress-bar',
  bylineLinks: 'ytmusic-player-bar .byline a',
  moviePlayer: '#movie_player',
});

const TRACK_SCRIPT = `(() => {
  const S = ${JSON.stringify(TRACK_SELECTORS)};
  if (!document.querySelector(S.bar)) return null;
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
  const v = document.querySelector(S.video);
  const art = document.querySelector(S.art)?.src || '';
  // video.currentTime/duration은 곡 전환 중이나 일부 곡에서 플레이어 바(화면에 보이는 시간)와 어긋난다.
  // 바의 진행 막대를 기준으로 하고, 읽을 수 없을 때만 video 값을 쓴다.
  const pb = document.querySelector(S.progress);
  const barMax = pb ? Number(pb.max) : NaN;
  const barOk = barMax > 0 && Number.isFinite(Number(pb.value));
  // byline 링크에서 아티스트(channel/...)를 읽는다. 업로드 곡 등은 링크가 없을 수 있다.
  const links = [...document.querySelectorAll(S.bylineLinks)].map((a) => a.href);
  const albumHref = [...document.querySelectorAll(S.bylineLinks)].map((a) => a.getAttribute('href') || '').find((h) => /^browse\\/MPREb_/.test(h)) || '';
  let videoId = '';
  try { videoId = document.querySelector(S.moviePlayer)?.getVideoData?.().video_id || ''; } catch {}
  return {
    title: text(S.title),
    byline: text(S.byline),
    links,
    videoId,
    albumBrowseId: albumHref.replace('browse/', ''),
    art,
    playing: !!v && !v.paused && !v.ended,
    position: barOk ? Number(pb.value) : v ? v.currentTime : 0,
    duration: barOk ? barMax : v ? v.duration : 0,
  };
})()`;

// Discord로 보내는 링크는 music.youtube.com 경로만 허용한다 (다른 호스트·형식은 버린다).
function ytmUrl(path) {
  return path ? `https://music.youtube.com${path}` : '';
}

function pickLink(links, pathPattern) {
  for (const l of Array.isArray(links) ? links : []) {
    try {
      const u = new URL(l);
      if (u.origin === 'https://music.youtube.com' && pathPattern.test(u.pathname)) return ytmUrl(u.pathname);
    } catch {}
  }
  return '';
}

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
    songUrl: ytmUrl(/^[\w-]{11}$/.test(raw.videoId || '') ? `/watch?v=${raw.videoId}` : ''),
    artistUrl: pickLink(raw.links, /^\/channel\/[\w-]+$/),
    // 앨범 링크는 browse/MPREb_ 대신 앨범 플레이리스트(OLAK5uy_) 주소를 쓴다.
    // browse 주소를 브라우저에서 열면 재생이 안 되는 경우가 실측됐다. readTrack이 채워 준다.
    albumUrl: ytmUrl(/^OLAK5uy_[\w-]+$/.test(raw.albumPlaylistId || '') ? `/playlist?list=${raw.albumPlaylistId}` : ''),
    playing: raw.playing === true,
    position: Number(raw.position),
    duration: Number(raw.duration),
  };
}

// 앨범 페이지 데이터의 헤더(musicResponsiveHeaderRenderer)에 있는 OLAK5uy_ ID가 앨범 자신의 것이다.
// 페이지에는 "다른 버전" 등 다른 앨범의 ID도 섞여 있어 헤더 밖에서 고르면 틀린다.
// music.youtube.com 페이지 안에서 같은 사이트 API를 쓰므로 새 외부 서버는 없다.
function albumScript(browseId) {
  return `(async () => {
    const ctx = ytcfg.get('INNERTUBE_CONTEXT');
    const r = await fetch('/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: ctx, browseId: ${JSON.stringify(browseId)} }),
    });
    if (!r.ok) return '';
    const find = (o) => {
      if (!o || typeof o !== 'object') return null;
      if (o.musicResponsiveHeaderRenderer) return o.musicResponsiveHeaderRenderer;
      for (const k in o) { const v = find(o[k]); if (v) return v; }
      return null;
    };
    const hdr = find(await r.json());
    const ids = [...new Set((JSON.stringify(hdr || {}).match(/OLAK5uy_[\\w-]+/g)) || [])];
    return ids.length === 1 ? ids[0] : '';
  })()`;
}

const albumCache = new Map(); // browseId -> { id, at }. 실패('')는 잠시 뒤 다시 시도한다.
const ALBUM_CACHE_MAX = 200;
const ALBUM_RETRY_MS = 30000;

async function resolveAlbumPlaylist(webContents, browseId, now = Date.now()) {
  if (!/^MPREb_[\w-]+$/.test(browseId || '')) return '';
  const hit = albumCache.get(browseId);
  if (hit && (hit.id || now - hit.at < ALBUM_RETRY_MS)) return hit.id;
  let id = '';
  try {
    const got = await webContents.executeJavaScript(albumScript(browseId));
    if (typeof got === 'string' && /^OLAK5uy_[\w-]+$/.test(got)) id = got;
  } catch {}
  if (albumCache.size >= ALBUM_CACHE_MAX) albumCache.clear();
  albumCache.set(browseId, { id, at: now });
  return id;
}

async function readTrack(webContents) {
  try {
    const raw = await webContents.executeJavaScript(TRACK_SCRIPT);
    if (raw && raw.albumBrowseId) raw.albumPlaylistId = await resolveAlbumPlaylist(webContents, raw.albumBrowseId);
    return parseTrack(raw);
  } catch {
    return null;
  }
}

module.exports = { SELECTORS, TRACK_SELECTORS, control, parseTrack, readTrack, resolveAlbumPlaylist };
