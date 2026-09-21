// GitHub Pages(구글 드라이브 모드)용 정적 사이트를 dist/ 에 만든다.
//   pages/          Pages 전용 화면(시작/재생/설정/서비스 워커)
//   public/js,css   서버 모드와 공유하는 코드(효과, 재생 코어, 드라이브 소스, 스타일)
//
// 환경변수(선택):
//   DRIVE_API_KEY     pages/config.js 의 apiKey 를 덮어쓴다 (GitHub Actions 변수로 주입)
//   DRIVE_API_BASE / DRIVE_IMAGE_BASE  테스트용 (목 서버 지정)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const SHARED = ['js/effects.js', 'js/player-core.js', 'js/drive-source.js', 'css/player.css', 'css/site.css'];

await fs.rm(DIST, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'pages'), DIST, { recursive: true });
for (const file of SHARED) {
  await fs.mkdir(path.dirname(path.join(DIST, file)), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'public', file), path.join(DIST, file));
}
await fs.writeFile(path.join(DIST, '.nojekyll'), '');

const overrides = {
  apiKey: process.env.DRIVE_API_KEY,
  apiBase: process.env.DRIVE_API_BASE,
  imageBase: process.env.DRIVE_IMAGE_BASE,
};
if (Object.values(overrides).some(Boolean)) {
  const { config } = await import(pathToFileURL(path.join(DIST, 'config.js')).href);
  const merged = { ...config, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)) };
  await fs.writeFile(path.join(DIST, 'config.js'), `export const config = ${JSON.stringify(merged, null, 2)};\n`);
}

const { config } = await import(`${pathToFileURL(path.join(DIST, 'config.js')).href}?t=${Date.now()}`);
console.log(`built ${path.relative(process.cwd(), DIST) || DIST}  (apiKey: ${config.apiKey ? 'set' : 'NOT SET'})`);
