// GitHub Pages와 같은 dist/ 정적 파일만 제공한다. 사진·음악은 브라우저에서 Drive로 요청한다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function createPreviewServer(root = ROOT) {
  const base = path.resolve(root);
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(base, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${base}${path.sep}`)) throw new Error('Outside root');
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createPreviewServer().listen(port, host, () => {
    console.log(`GitHub Pages 미리보기: http://${host}:${port}`);
    console.log('사진·음악·LP 이미지는 구글 드라이브 폴더에서 불러옵니다.');
  });
}
