import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../scripts/preview-pages.mjs';

const pages = fileURLToPath(new URL('../pages/', import.meta.url));

test('기본 미리보기는 드라이브 URL 생성 화면과 재생 진입점을 제공하며 서버 API를 제공하지 않는다', async () => {
  const server = createPreviewServer(pages);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const index = await (await fetch(`${base}/`)).text();
    assert.match(index, /id="folder"/);
    assert.match(index, /id="bgmFolder"/);
    assert.match(index, /id="frameWidth"/);
    assert.doesNotMatch(index, /id="create"/);
    const player = await (await fetch(`${base}/player.html?folder=exampleFolder&bgm=musicFolder`)).text();
    assert.match(player, /\.\/js\/drive-player.js/);
    const source = await fetch(`${base}/js/drive-player.js`);
    assert.match(source.headers.get('content-type'), /javascript/);
    assert.match(await source.text(), /createDriveSource/);
    for (const url of ['/api/slideshows', '/server.js', '/%2e%2e%2fpackage.json']) {
      assert.equal((await fetch(`${base}${url}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(`${base}/`, { method: 'HEAD' })).text(), '');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
