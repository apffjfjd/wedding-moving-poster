import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFolderId, parsePhotoName, toPhotos, createDriveSource } from '../public/js/drive-source.js';

const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('parseFolderId: 다양한 드라이브 링크 형태와 ID 직접 입력을 인식한다', () => {
  assert.equal(parseFolderId(FOLDER), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/drive/folders/${FOLDER}`), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/drive/u/0/folders/${FOLDER}`), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/open?id=${FOLDER}`), FOLDER);
  assert.equal(parseFolderId(`  ${FOLDER}  `), FOLDER);
});

test('parseFolderId: 잘못된 입력과 쿼리 주입 시도는 null', () => {
  for (const bad of ['', null, undefined, 'hello', 'https://example.com/', 'short', `${FOLDER}' or '1'='1`, "1' in parents or name contains '"]) {
    assert.equal(parseFolderId(bad), null, String(bad));
  }
});

test('parsePhotoName: 파일명에서 효과를 읽는다', () => {
  assert.equal(parsePhotoName('03_kenburns.jpg').effect, 'kenburns');
  assert.equal(parsePhotoName('04_zoom-in.jpg').effect, 'zoomin');
  assert.equal(parsePhotoName('05_Cross-Dissolve.PNG').effect, 'crossdissolve');
  assert.equal(parsePhotoName('06 blur.webp').effect, 'blur');
  assert.equal(parsePhotoName('07_parallax_웨딩.jpg').effect, 'parallax');
  assert.equal(parsePhotoName('pan.jpg').effect, 'pan');
});

test('parsePhotoName: 효과 이름이 없거나 단어 일부일 뿐이면 자동', () => {
  assert.equal(parsePhotoName('08.jpg').effect, 'auto');
  assert.equal(parsePhotoName('IMG_2041.jpg').effect, 'auto');
  assert.equal(parsePhotoName('panorama_01.jpg').effect, 'auto'); // 'pan'이 단어 일부일 뿐
  assert.equal(parsePhotoName('fade.jpg.jpg').effect, 'auto'); // 마지막 확장자만 제거되어 'fade.jpg' 조각이 남음
  assert.equal(parsePhotoName('001_auto.jpg').effect, 'auto');
});

const cfg = { apiBase: 'https://api.test/drive/v3', imageBase: 'https://img.test/d', apiKey: 'K&Y' };
const file = (id, name, extra = {}) => ({ id, name, mimeType: 'image/jpeg', modifiedTime: '2026-09-21T00:00:00Z', ...extra });

test('toPhotos: 숫자 인식 이름순으로 정렬한다 (2가 10보다 먼저)', () => {
  const photos = toPhotos({ files: [file('c', '10_a.jpg'), file('a', '2_b.jpg'), file('b', '1_c.jpg')] }, cfg);
  assert.deepEqual(photos.map((p) => p.id), ['b', 'a', 'c']);
});

test('toPhotos: 이미지가 아니거나 숨김 파일은 제외한다', () => {
  const photos = toPhotos(
    {
      files: [
        file('a', '1.jpg'),
        file('b', 'notes.txt', { mimeType: 'text/plain' }),
        file('c', '.hidden.jpg'),
        file('d', 'video.mp4', { mimeType: 'video/mp4' }),
        file('e', '2.heic', { mimeType: 'image/heic' }),
      ],
    },
    cfg,
  );
  assert.deepEqual(photos.map((p) => p.id), ['a', 'e']);
});

test('toPhotos: 효과·버전·대체 URL 구성', () => {
  const [p] = toPhotos(
    { files: [file('id1', '01_kenburns.jpg', { thumbnailLink: 'https://lh3.test/abc=s220', imageMediaMetadata: { width: 4000, height: 3000 } })] },
    cfg,
  );
  assert.equal(p.effect, 'kenburns');
  assert.equal(p.url, 'https://img.test/d/id1=s1920');
  assert.equal(p.version, '2026-09-21T00:00:00Z');
  assert.equal(p.viaFetch, true);
  assert.deepEqual(p.fallbacks, ['https://lh3.test/abc=s1920', 'https://api.test/drive/v3/files/id1?alt=media&key=K%26Y']);
  assert.equal(p.width, 4000);
});

test('toPhotos: 썸네일이 없으면 API 원본 다운로드만 대체 URL로 쓴다', () => {
  const [p] = toPhotos({ files: [file('id2', '1.jpg')] }, cfg);
  assert.equal(p.fallbacks.length, 1);
  assert.match(p.fallbacks[0], /alt=media/);
});

test('toPhotos: 파일 목록이 없어도 빈 배열', () => {
  assert.deepEqual(toPhotos({}, cfg), []);
});

// ---- createDriveSource.load 상태 매핑 (fetch를 가짜로 대체) ----
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const source = (apiKey = 'KEY') => createDriveSource({ folderId: FOLDER, config: { ...cfg, apiKey } });

test('load: API 키가 없으면 error 상태와 안내 문구', async () => {
  const r = await source('').load();
  assert.equal(r.status, 'error');
  assert.match(r.message, /API 키/);
});

test('load: 정상 응답이면 정렬된 사진 목록을 돌려준다', async () => {
  const r = await withFetch(
    async (url) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get('key'), 'KEY');
      assert.ok(u.searchParams.get('q').includes(`'${FOLDER}' in parents`));
      return json({ files: [file('b', '2.jpg'), file('a', '1.jpg')] });
    },
    () => source().load(),
  );
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.photos.map((p) => p.id), ['a', 'b']);
});

test('load: 네트워크 예외와 5xx는 offline (마지막 목록으로 계속 재생하게 한다)', async () => {
  assert.equal((await withFetch(async () => { throw new TypeError('Failed to fetch'); }, () => source().load())).status, 'offline');
  assert.equal((await withFetch(async () => json({}, 503), () => source().load())).status, 'offline');
});

test('load: 400/401/403은 API 키·한도 문제로 error', async () => {
  for (const status of [400, 401, 403]) {
    const r = await withFetch(async () => json({ error: {} }, status), () => source().load());
    assert.equal(r.status, 'error', String(status));
  }
});

test('load: 빈 목록이면 폴더 접근 여부로 gone 과 빈 폴더를 구분한다', async () => {
  const handler = (folderStatus) => async (url) => (new URL(url).pathname.endsWith(`/files/${FOLDER}`) ? json({}, folderStatus) : json({ files: [] }));
  const gone = await withFetch(handler(404), () => source().load());
  assert.equal(gone.status, 'gone');
  const empty = await withFetch(handler(200), () => source().load());
  assert.deepEqual(empty, { status: 'ok', photos: [] });
});
