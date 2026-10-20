// Discord "듣는 중" 활동. Discord가 꺼져 있어도 앱에는 영향이 없고, 켜지면 다시 연결한다.
const CLIENT_ID = '1559850212585898054';
const LISTENING = 2; // Discord ActivityType.Listening
const STATUS_DISPLAY_DETAILS = 2; // Discord StatusDisplayType.DETAILS
// Discord 개발자 포털 앱의 Rich Presence Art Assets에 이 이름으로 올린 이미지 키
const PAUSED_ICON = 'paused';
const RETRY_MS = 15000;
const SEEK_TOLERANCE_MS = 3000;

// Discord는 details/state를 2~128자로 요구한다.
function clip(text, fallback = '') {
  const s = String(text || fallback).trim();
  if (!s) return undefined;
  const padded = s.length < 2 ? s + '​' : s;
  return padded.length > 128 ? padded.slice(0, 127) + '…' : padded;
}

// track: { title, artist, album, art, playing, position(초), duration(초) }
function buildActivity(track, now = Date.now()) {
  if (!track || !clip(track.title)) return null;
  // statusDisplayType DETAILS: 미니 프로필/멤버 목록에 앱 이름 대신 곡 제목을 표시한다.
  const activity = { type: LISTENING, statusDisplayType: STATUS_DISPLAY_DETAILS, details: clip(track.title) };
  const artist = clip(track.artist);
  if (artist) activity.state = artist;
  if (typeof track.art === 'string' && /^https:\/\//.test(track.art)) activity.largeImageKey = track.art;
  const album = clip(track.album);
  if (album) activity.largeImageText = album;
  if (!track.playing) {
    // 일시정지: 진행바가 흘러가지 않도록 타임스탬프를 빼고 작은 아이콘으로 표시한다.
    activity.smallImageKey = PAUSED_ICON;
    activity.smallImageText = 'Paused';
  } else if (Number.isFinite(track.position) && Number.isFinite(track.duration) && track.duration > 0) {
    const start = Math.round(now - track.position * 1000);
    activity.startTimestamp = start;
    activity.endTimestamp = start + Math.round(track.duration * 1000);
  }
  return activity;
}

function sameActivity(a, b) {
  if (!a || !b) return a === b;
  for (const k of ['details', 'state', 'largeImageKey', 'largeImageText', 'smallImageKey']) if (a[k] !== b[k]) return false;
  const da = Math.abs((a.startTimestamp || 0) - (b.startTimestamp || 0));
  const de = Math.abs((a.endTimestamp || 0) - (b.endTimestamp || 0));
  return da <= SEEK_TOLERANCE_MS && de <= SEEK_TOLERANCE_MS;
}

function createPresence({ clientId = CLIENT_ID, createClient, retryMs = RETRY_MS, now = Date.now } = {}) {
  const make = createClient || ((id) => {
    const { Client } = require('@xhayper/discord-rpc');
    return new Client({ clientId: id });
  });
  let client = null;
  let ready = false;
  let connecting = false;
  let retryAt = 0;
  let desired = null; // 마지막으로 원하는 활동 (null이면 비움)
  let applied; // 마지막으로 Discord에 반영한 활동 (undefined = 아직 없음)
  let enabled = true;

  function drop() {
    const c = client;
    client = null;
    ready = false;
    connecting = false;
    applied = undefined;
    retryAt = now() + retryMs;
    if (c) c.destroy().catch(() => {});
  }

  async function flush() {
    if (!ready || !client) return;
    if (applied !== undefined && sameActivity(desired, applied)) return;
    const c = client;
    try {
      if (desired) await c.user.setActivity(desired);
      else await c.user.clearActivity();
      applied = desired;
    } catch {
      if (c === client) drop();
    }
  }

  function connect() {
    if (client || connecting || now() < retryAt) return;
    connecting = true;
    const c = make(clientId);
    client = c;
    c.on('ready', () => {
      if (c !== client) return;
      ready = true;
      connecting = false;
      flush();
    });
    c.on('disconnected', () => {
      if (c === client) drop();
    });
    c.login().catch(() => {
      if (c === client) drop();
    });
  }

  return {
    update(track) {
      if (!enabled) return;
      desired = buildActivity(track, now());
      if (desired) connect();
      flush();
    },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        desired = null;
        // 활동을 비운 뒤에 연결을 닫는다. 다시 켜면 곧바로 연결할 수 있게 재시도 대기를 없앤다.
        flush().finally(() => {
          drop();
          retryAt = 0;
        });
      }
    },
    destroy() {
      enabled = false;
      desired = null;
      const c = client;
      client = null;
      ready = false;
      if (c) c.destroy().catch(() => {});
    },
  };
}

module.exports = { CLIENT_ID, buildActivity, sameActivity, createPresence };
