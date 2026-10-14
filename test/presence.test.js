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

test('일시정지, 곡 없음, 제목 없음이면 null', () => {
  assert.equal(buildActivity({ ...track, playing: false }), null);
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

test('presence: 연결 후 활동을 한 번만 반영하고, 정지하면 비운다', async () => {
  const log = [];
  const p = createPresence({ createClient: () => fakeClient(log) });
  p.update(track);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  p.update({ ...track, position: 31 });
  await new Promise((r) => setImmediate(r));
  p.update({ ...track, playing: false });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ['login', ['set', 'Song'], 'clear']);
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
