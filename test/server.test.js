import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, sniffImage, LIMITS } from '../server.js';

// 최소한의 유효한 JPEG/PNG 시그니처 (서버는 시그니처만 검사한다)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);

let server, base, dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-test-'));
  server = createApp({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

const createShow = async () => (await fetch(`${base}/api/slideshows`, { method: 'POST' })).json();

const upload = (id, key, body = JPEG, { w = '1600', h = '900' } = {}) =>
  fetch(`${base}/api/slideshows/${id}/photos`, {
    method: 'POST',
    headers: { 'x-edit-key': key, 'x-photo-width': w, 'x-photo-height': h, 'Content-Type': 'image/jpeg' },
    body,
  });

test('sniffImage: 시그니처로 형식을 판별한다', () => {
  assert.equal(sniffImage(JPEG), 'jpg');
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(Buffer.from('<html>not an image</html>')), null);
});

test('FR-004: 생성 시 고유 URL과 편집 키를 발급하고, 공개 응답에는 키가 없다', async () => {
  const a = await createShow();
  const b = await createShow();
  assert.notEqual(a.id, b.id);
  assert.equal(a.playUrl, `/s/${a.id}`);
  assert.ok(a.editKey.length >= 24);

  const meta = await (await fetch(`${base}/api/slideshows/${a.id}`)).json();
  assert.deepEqual(meta.photos, []);
  assert.ok(!JSON.stringify(meta).includes(a.editKey));
  assert.ok(!('keyHash' in meta));
});

test('FR-001: 사진을 업로드하면 목록에 등록되고 이미지를 내려받을 수 있다', async () => {
  const { id, editKey } = await createShow();
  const res = await upload(id, editKey, JPEG, { w: '900', h: '1600' });
  assert.equal(res.status, 201);
  const photo = await res.json();
  assert.equal(photo.width, 900);
  assert.equal(photo.height, 1600);
  assert.equal(photo.effect, 'auto');

  const img = await fetch(`${base}${photo.url}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPEG);

  const meta = await (await fetch(`${base}/api/slideshows/${id}`)).json();
  assert.equal(meta.photos.length, 1);
});

test('업로드는 등록 순서를 유지하고 변경 시마다 version이 증가한다', async () => {
  const { id, editKey } = await createShow();
  const v0 = (await (await fetch(`${base}/api/slideshows/${id}`)).json()).version;
  const first = await (await upload(id, editKey, JPEG)).json();
  const second = await (await upload(id, editKey, PNG)).json();
  const meta = await (await fetch(`${base}/api/slideshows/${id}`)).json();
  assert.deepEqual(meta.photos.map((p) => p.id), [first.id, second.id]);
  assert.ok(meta.version > v0);
});

test('권한: 편집 키가 없거나 틀리면 403, 존재하지 않는 슬라이드쇼는 404', async () => {
  const { id } = await createShow();
  assert.equal((await upload(id, 'wrong-key')).status, 403);
  assert.equal((await upload(id, '')).status, 403);
  assert.equal((await fetch(`${base}/api/slideshows/${id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/api/slideshows/aaaaaaaaaaaa`)).status, 404);
});

test('검증: 이미지가 아닌 파일은 415, 크기 정보 누락은 400', async () => {
  const { id, editKey } = await createShow();
  assert.equal((await upload(id, editKey, Buffer.from('hello world, not an image'))).status, 415);
  assert.equal((await upload(id, editKey, JPEG, { w: '', h: '' })).status, 400);
});

test('검증: 용량 상한을 넘으면 413', async () => {
  const { id, editKey } = await createShow();
  const big = Buffer.concat([JPEG, Buffer.alloc(LIMITS.maxPhotoBytes)]);
  const res = await upload(id, editKey, big).catch(() => ({ status: 413 })); // 서버가 연결을 끊는 경우 포함
  assert.equal(res.status, 413);
});

test('FR-002: 사진별 효과를 지정하고 잘못된 효과는 거부한다', async () => {
  const { id, editKey } = await createShow();
  const photo = await (await upload(id, editKey)).json();
  const patch = (effect) =>
    fetch(`${base}/api/slideshows/${id}/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'x-edit-key': editKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ effect }),
    });

  assert.equal((await patch('kenburns')).status, 200);
  assert.equal((await patch('explode')).status, 400);
  const meta = await (await fetch(`${base}/api/slideshows/${id}`)).json();
  assert.equal(meta.photos[0].effect, 'kenburns');
});

test('사진 삭제 시 목록과 파일이 함께 제거된다', async () => {
  const { id, editKey } = await createShow();
  const photo = await (await upload(id, editKey)).json();
  const res = await fetch(`${base}/api/slideshows/${id}/photos/${photo.id}`, { method: 'DELETE', headers: { 'x-edit-key': editKey } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).photos, []);
  assert.equal((await fetch(`${base}${photo.url}`)).status, 404);
});

test('슬라이드쇼 삭제 시 데이터가 모두 지워지고 URL이 404가 된다', async () => {
  const { id, editKey } = await createShow();
  const photo = await (await upload(id, editKey)).json();
  const res = await fetch(`${base}/api/slideshows/${id}`, { method: 'DELETE', headers: { 'x-edit-key': editKey } });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${base}/api/slideshows/${id}`)).status, 404);
  assert.equal((await fetch(`${base}${photo.url}`)).status, 404);
  await assert.rejects(fs.access(path.join(dataDir, id)));
});

test('동시 업로드해도 meta가 깨지지 않고 모든 사진이 등록된다', async () => {
  const { id, editKey } = await createShow();
  const results = await Promise.all(Array.from({ length: 8 }, () => upload(id, editKey)));
  assert.ok(results.every((r) => r.status === 201));
  const meta = await (await fetch(`${base}/api/slideshows/${id}`)).json();
  assert.equal(meta.photos.length, 8);
  assert.equal(new Set(meta.photos.map((p) => p.id)).size, 8);
});

test('보안: 경로 조작 요청은 정적/사진 경로 모두에서 거부된다', async () => {
  const { id } = await createShow();
  for (const p of ['/photos/../server.js', `/photos/${id}/..%2f..%2fmeta.json`, '/../server.js', '/%2e%2e/server.js', `/photos/${id}/meta.json`]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, p);
  }
});

test('페이지 라우팅: / , /s/:id , /e/:id 가 각각 HTML을 반환한다', async () => {
  const { id } = await createShow();
  for (const [p, marker] of [['/', '새 슬라이드쇼 만들기'], [`/s/${id}`, 'id="stage"'], [`/e/${id}`, '슬라이드쇼 편집']]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(marker), p);
  }
});
