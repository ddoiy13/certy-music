const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActivity, sameActivity, createPresence } = require('../src/presence');
const { parseTrack } = require('../src/player');

const track = { title: 'Song', artist: 'Artist', album: 'Album', art: 'https://i.ytimg.com/a.jpg', playing: true, position: 30, duration: 200 };

test('재생 중인 곡은 듣는 중 활동으로 변환된다', () => {
  const a = buildActivity(track, 1_000_000);
  assert.equal(a.type, 2);
  assert.equal(a.statusDisplayType, 2);
  assert.equal(a.details, 'Song');
  assert.equal(a.state, 'Artist');
  assert.equal(a.largeImageKey, 'https://i.ytimg.com/a.jpg');
  assert.equal(a.startTimestamp, 1_000_000 - 30_000);
  assert.equal(a.endTimestamp, 1_000_000 - 30_000 + 200_000);
});

test('일시정지면 활동을 유지하되 타임스탬프 없이 일시정지 아이콘을 붙인다', () => {
  const a = buildActivity({ ...track, playing: false }, 1_000_000);
  assert.equal(a.details, 'Song');
  assert.equal(a.smallImageKey, 'paused');
  assert.equal(a.smallImageText, 'Paused');
  assert.equal(a.startTimestamp, undefined);
  assert.equal(a.endTimestamp, undefined);
  assert.equal(buildActivity(track, 1_000_000).smallImageKey, undefined);
  assert.equal(sameActivity(buildActivity(track, 1_000_000), a), false);
});

test('곡 없음, 제목 없음이면 null', () => {
  assert.equal(buildActivity(null), null);
  assert.equal(buildActivity({ ...track, title: '' }), null);
});

test('https가 아닌 앨범아트는 쓰지 않고, 한 글자 제목은 2자로 맞춘다', () => {
  const a = buildActivity({ ...track, art: 'http://x/a.jpg', title: 'A' });
  assert.equal(a.largeImageKey, undefined);
  assert.ok(a.details.length >= 2);
});

test('128자를 넘는 문자열은 잘린다', () => {
  assert.ok(buildActivity({ ...track, title: 'x'.repeat(300) }).details.length <= 128);
});

test('길이 정보가 없으면 타임스탬프를 생략한다', () => {
  const a = buildActivity({ ...track, duration: NaN });
  assert.equal(a.startTimestamp, undefined);
});

test('같은 곡의 자연스러운 진행은 같은 활동, 탐색(seek)은 다른 활동', () => {
  const a = buildActivity(track, 1_000_000);
  assert.equal(sameActivity(a, buildActivity({ ...track, position: 31 }, 1_001_000)), true);
  assert.equal(sameActivity(a, buildActivity({ ...track, position: 120 }, 1_001_000)), false);
  assert.equal(sameActivity(a, buildActivity({ ...track, title: 'Other' }, 1_000_000)), false);
});

test('시작 시각이 같아도 곡 길이(종료 시각)가 바뀌면 다른 활동', () => {
  // 자동 전환 직후 이전 곡의 길이가 잠깐 읽히는 경우를 가정한다.
  const stale = buildActivity({ ...track, position: 0, duration: 200 }, 1_000_000);
  const fixed = buildActivity({ ...track, position: 0, duration: 245 }, 1_000_000);
  assert.equal(sameActivity(stale, fixed), false);
});

test('링크는 music.youtube.com일 때만 활동에 붙고, 없으면 생략된다', () => {
  const L = { songUrl: 'https://music.youtube.com/watch?v=abcdefghijk', artistUrl: 'https://music.youtube.com/channel/UC1', albumUrl: 'https://music.youtube.com/browse/MPREb_1' };
  const a = buildActivity({ ...track, ...L });
  assert.equal(a.detailsUrl, L.songUrl);
  assert.equal(a.stateUrl, L.artistUrl);
  assert.equal(a.largeImageUrl, L.albumUrl);
  const b = buildActivity({ ...track, songUrl: 'https://evil.example/x', artistUrl: 'http://music.youtube.com/channel/UC1' });
  assert.equal(b.detailsUrl, undefined);
  assert.equal(b.stateUrl, undefined);
  assert.equal(buildActivity(track).detailsUrl, undefined);
  assert.equal(sameActivity(a, buildActivity({ ...track, ...L, songUrl: 'https://music.youtube.com/watch?v=zzzzzzzzzzz' })), false);
});

test('parseTrack은 byline 링크, videoId, 앨범 플레이리스트에서 안전한 링크만 뽑는다', () => {
  const t = parseTrack({ title: 'S', byline: 'A • B', videoId: 'UwgUYZsyl7g', albumPlaylistId: 'OLAK5uy_kL-RC56', links: ['https://music.youtube.com/browse/MPREb_y', 'https://evil.example/channel/UC_z', 'https://music.youtube.com/channel/UC_x'] });
  assert.equal(t.songUrl, 'https://music.youtube.com/watch?v=UwgUYZsyl7g');
  assert.equal(t.artistUrl, 'https://music.youtube.com/channel/UC_x');
  assert.equal(t.albumUrl, 'https://music.youtube.com/playlist?list=OLAK5uy_kL-RC56');
  // 앨범 플레이리스트(OLAK5uy_) 형식이 아니면 앨범 링크를 만들지 않는다.
  assert.equal(parseTrack({ title: 'S', byline: 'A', albumPlaylistId: 'RDAMVMabc', links: [] }).albumUrl, '');
  assert.equal(parseTrack({ title: 'S', byline: 'A', links: [] }).albumUrl, '');
  const n = parseTrack({ title: 'S', byline: 'A', videoId: 'bad id', links: [] });
  assert.equal(n.songUrl, '');
  assert.equal(n.albumUrl, '');
});

test('parseTrack은 byline을 아티스트/앨범으로 나누고 큰 아트로 바꾼다', () => {
  const t = parseTrack({ title: 'S', byline: 'Art • Alb • 2020', art: 'https://lh3.googleusercontent.com/x=w60-h60-l90-rj', playing: true, position: 1, duration: 2 });
  assert.equal(t.artist, 'Art');
  assert.equal(t.album, 'Alb');
  assert.equal(t.art, 'https://lh3.googleusercontent.com/x=w512-h512');
  assert.equal(parseTrack({ title: '' }), null);
  assert.equal(parseTrack(null), null);
});

function fakeClient(log) {
  const handlers = {};
  return {
    on: (e, f) => { handlers[e] = f; },
    login: async () => { log.push('login'); setImmediate(() => handlers.ready && handlers.ready()); },
    destroy: async () => { log.push('destroy'); },
    user: {
      setActivity: async (a) => { log.push(['set', a.details]); },
      clearActivity: async () => { log.push('clear'); },
    },
  };
}

test('presence: 연결 후 활동을 한 번만 반영하고, 일시정지하면 비우지 않고 갱신한다', async () => {
  const log = [];
  const p = createPresence({ createClient: () => fakeClient(log) });
  p.update(track);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  p.update({ ...track, position: 31 });
  await new Promise((r) => setImmediate(r));
  p.update({ ...track, playing: false });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ['login', ['set', 'Song'], ['set', 'Song']]);
  p.destroy();
});

test('presence: 연결 실패는 던지지 않고 재시도 대기에 들어간다', async () => {
  let n = 0;
  const failing = () => ({
    on() {},
    login: async () => { n++; throw new Error('no discord'); },
    destroy: async () => {},
    user: {},
  });
  let t = 0;
  const p = createPresence({ createClient: failing, retryMs: 1000, now: () => t });
  p.update(track);
  await new Promise((r) => setImmediate(r));
  p.update(track);
  assert.equal(n, 1); // 대기 중에는 재시도하지 않는다
  t = 2000;
  p.update(track);
  assert.equal(n, 2);
  p.destroy();
});

test('readTrack은 앨범 플레이리스트를 한 번만 조회해 캐시하고, 잘못된 값은 버린다', async () => {
  const { readTrack, resolveAlbumPlaylist } = require('../src/player');
  let albumCalls = 0;
  const wc = (albumReply) => ({
    executeJavaScript: async (s) => {
      if (s.includes('youtubei')) { albumCalls++; return albumReply; }
      return { title: 'S', byline: 'A • B', videoId: 'UwgUYZsyl7g', albumBrowseId: 'MPREb_cache1', links: [] };
    },
  });
  const ok = wc('OLAK5uy_good-id');
  assert.equal((await readTrack(ok)).albumUrl, 'https://music.youtube.com/playlist?list=OLAK5uy_good-id');
  await readTrack(ok);
  assert.equal(albumCalls, 1);
  // 형식이 다른 응답이나 잘못된 browseId는 링크 없이 지나간다.
  assert.equal(await resolveAlbumPlaylist(wc('javascript:alert(1)'), 'MPREb_bad1'), '');
  assert.equal(await resolveAlbumPlaylist(wc('OLAK5uy_x'), 'not-an-id'), '');
  // 실패는 바로 재시도하지 않고, 시간이 지나면 다시 시도한다.
  const before = albumCalls;
  await resolveAlbumPlaylist(wc(''), 'MPREb_fail1', 1000);
  await resolveAlbumPlaylist(wc(''), 'MPREb_fail1', 2000);
  assert.equal(albumCalls, before + 1);
  await resolveAlbumPlaylist(wc(''), 'MPREb_fail1', 40000);
  assert.equal(albumCalls, before + 2);
});
