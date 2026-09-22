// 셀프 웨딩 무빙 포스터 서버 (BD-0003)
// - 편집 영역(업로드/설정)과 재생 영역(URL 접속)을 같은 서버에서 제공한다.
// - 렌더링은 전부 브라우저에서 수행하므로 서버는 사진/메타데이터 저장과 배포만 담당한다.
// - 외부 의존성 없이 Node 내장 모듈만 사용한다.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECT_IDS } from './public/js/effects.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

// 업로드 용량/개수 제한은 REQ-0003 미결정 사항이라 임시 상한을 둔다.
export const LIMITS = {
  maxPhotos: 100,
  maxPhotoBytes: 12 * 1024 * 1024,
  maxAudioBytes: 20 * 1024 * 1024, // 배경음악은 5분 mp3(128kbps) 기준 약 5MB, 여유를 둔다
  maxJsonBytes: 16 * 1024,
};

const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const PHOTO_FILE_RE = /^[A-Za-z0-9_-]{12}\.(jpg|png|webp)$/;
const AUDIO_FILE_RE = /^[A-Za-z0-9_-]{12}\.(mp3|ogg|wav|m4a)$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = () => crypto.randomBytes(9).toString('base64url'); // 12자
const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

/** 파일 시그니처로 이미지 형식을 판별한다. 지원하지 않으면 null. */
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** 파일 시그니처로 오디오 형식을 판별한다. 지원하지 않으면 null. */
export function sniffAudio(buf) {
  if (buf.length > 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'mp3'; // "ID3" 태그
  if (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG 프레임 동기
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (buf.length >= 8 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a'; // MP4/M4A 컨테이너
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) return reject(new HttpError(413, '파일이 너무 큽니다.'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '파일이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, LIMITS.maxJsonBytes);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, '잘못된 JSON 입니다.');
  }
}

function send(res, status, body, headers = {}) {
  const isJson = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body ?? '';
  res.writeHead(status, {
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function createApp({ dataDir }) {
  // 같은 슬라이드쇼에 대한 쓰기를 직렬화해 meta.json 경합을 막는다.
  const locks = new Map();
  const withLock = (id, fn) => {
    const prev = locks.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(id, next.catch(() => {}));
    return next;
  };

  const showDir = (id) => path.join(dataDir, id);
  const metaPath = (id) => path.join(showDir(id), 'meta.json');

  async function loadMeta(id) {
    if (!ID_RE.test(id)) throw new HttpError(404, '슬라이드쇼를 찾을 수 없습니다.');
    try {
      return JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') throw new HttpError(404, '슬라이드쇼를 찾을 수 없습니다.');
      throw err;
    }
  }

  async function saveMeta(meta) {
    meta.version = (meta.version || 0) + 1;
    meta.updatedAt = new Date().toISOString();
    const tmp = `${metaPath(meta.id)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(meta));
    await fs.rename(tmp, metaPath(meta.id));
  }

  function assertKey(meta, req) {
    const given = String(req.headers['x-edit-key'] || '');
    const a = Buffer.from(hashKey(given));
    const b = Buffer.from(meta.keyHash);
    if (!given || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, '편집 키가 올바르지 않습니다.');
  }

  const publicView = (meta) => ({
    id: meta.id,
    version: meta.version,
    updatedAt: meta.updatedAt,
    photos: meta.photos.map((p) => ({
      id: p.id,
      url: `/photos/${meta.id}/${p.file}`,
      width: p.width,
      height: p.height,
      effect: p.effect,
    })),
    // 파일명이 업로드마다 새로 생기므로, url 자체가 재생기 입장의 버전 값이 된다.
    audio: meta.audio ? { id: meta.audio.id, url: `/audio/${meta.id}/${meta.audio.file}` } : null,
  });

  const clampDim = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 && n <= 20000 ? n : null;
  };

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api','slideshows',id,...]
    const [, resource, id, sub, subId] = parts;
    if (resource !== 'slideshows') throw new HttpError(404, 'Not found');

    // FR-001/FR-004: 슬라이드쇼 생성 + 고유 URL 발급
    if (!id) {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      const newShowId = newId();
      const editKey = crypto.randomBytes(24).toString('base64url');
      await fs.mkdir(path.join(showDir(newShowId), 'photos'), { recursive: true });
      const meta = { id: newShowId, keyHash: hashKey(editKey), createdAt: new Date().toISOString(), version: 0, photos: [], audio: null };
      await saveMeta(meta);
      return send(res, 201, {
        id: newShowId,
        editKey,
        playUrl: `/s/${newShowId}`,
        editUrl: `/e/${newShowId}#key=${editKey}`,
      });
    }

    // 재생/편집 화면이 공통으로 읽는 공개 메타데이터. 캐시하지 않아야 변경이 즉시 반영된다.
    if (!sub && req.method === 'GET') {
      const meta = await loadMeta(id);
      return send(res, 200, publicView(meta), { 'Cache-Control': 'no-store' });
    }

    if (sub === 'auth' && req.method === 'GET') {
      assertKey(await loadMeta(id), req);
      return send(res, 204, null);
    }

    if (!sub && req.method === 'DELETE') {
      return withLock(id, async () => {
        assertKey(await loadMeta(id), req);
        await fs.rm(showDir(id), { recursive: true, force: true });
        send(res, 204, null);
      });
    }

    if (sub === 'photos' && !subId && req.method === 'POST') {
      // 사진 본문을 읽기 전에 키부터 검증해 무권한 대용량 전송을 막는다.
      assertKey(await loadMeta(id), req);
      const body = await readBody(req, LIMITS.maxPhotoBytes);
      const ext = sniffImage(body);
      if (!ext) throw new HttpError(415, 'JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.');
      const width = clampDim(req.headers['x-photo-width']);
      const height = clampDim(req.headers['x-photo-height']);
      if (!width || !height) throw new HttpError(400, '사진 크기 정보(x-photo-width/height)가 필요합니다.');

      return withLock(id, async () => {
        const meta = await loadMeta(id);
        if (meta.photos.length >= LIMITS.maxPhotos) throw new HttpError(409, `사진은 최대 ${LIMITS.maxPhotos}장까지 등록할 수 있습니다.`);
        const photo = { id: newId(), file: `${newId()}.${ext}`, width, height, effect: 'auto' };
        await fs.mkdir(path.join(showDir(id), 'photos'), { recursive: true });
        await fs.writeFile(path.join(showDir(id), 'photos', photo.file), body);
        meta.photos.push(photo);
        await saveMeta(meta);
        send(res, 201, publicView(meta).photos.find((p) => p.id === photo.id));
      });
    }

    if (sub === 'photos' && subId && (req.method === 'PATCH' || req.method === 'DELETE')) {
      assertKey(await loadMeta(id), req);
      const patch = req.method === 'PATCH' ? await readJson(req) : null;
      return withLock(id, async () => {
        const meta = await loadMeta(id);
        const idx = meta.photos.findIndex((p) => p.id === subId);
        if (idx < 0) throw new HttpError(404, '사진을 찾을 수 없습니다.');
        if (patch) {
          if (!EFFECT_IDS.includes(patch.effect)) throw new HttpError(400, '지원하지 않는 효과입니다.');
          meta.photos[idx].effect = patch.effect;
        } else {
          const [removed] = meta.photos.splice(idx, 1);
          await fs.rm(path.join(showDir(id), 'photos', removed.file), { force: true });
        }
        await saveMeta(meta);
        send(res, 200, publicView(meta));
      });
    }

    // 배경음악: 슬라이드쇼당 한 곡만 유지한다(향후 확장 여지, REQ-0003 미결정 범위 밖이라 단순하게 시작).
    if (sub === 'audio' && req.method === 'POST') {
      assertKey(await loadMeta(id), req);
      const body = await readBody(req, LIMITS.maxAudioBytes);
      const ext = sniffAudio(body);
      if (!ext) throw new HttpError(415, 'MP3, OGG, WAV, M4A 음악 파일만 업로드할 수 있습니다.');

      return withLock(id, async () => {
        const meta = await loadMeta(id);
        await fs.mkdir(path.join(showDir(id), 'audio'), { recursive: true });
        const previous = meta.audio;
        meta.audio = { id: newId(), file: `${newId()}.${ext}` };
        await fs.writeFile(path.join(showDir(id), 'audio', meta.audio.file), body);
        if (previous) await fs.rm(path.join(showDir(id), 'audio', previous.file), { force: true });
        await saveMeta(meta);
        send(res, 201, publicView(meta).audio);
      });
    }

    if (sub === 'audio' && req.method === 'DELETE') {
      assertKey(await loadMeta(id), req);
      return withLock(id, async () => {
        const meta = await loadMeta(id);
        if (meta.audio) {
          await fs.rm(path.join(showDir(id), 'audio', meta.audio.file), { force: true });
          meta.audio = null;
          await saveMeta(meta);
        }
        send(res, 200, publicView(meta));
      });
    }

    throw new HttpError(404, 'Not found');
  }

  async function serveMedia(res, url, kind) {
    const [, , id, file] = url.pathname.split('/'); // /photos/:id/:file 또는 /audio/:id/:file
    const re = kind === 'photos' ? PHOTO_FILE_RE : AUDIO_FILE_RE;
    if (!ID_RE.test(id || '') || !re.test(file || '')) throw new HttpError(404, 'Not found');
    const filePath = path.join(showDir(id), kind, file);
    let data;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    // 파일명이 무작위이고 내용이 바뀌지 않으므로 오래 캐시해도 안전하다.
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file)],
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }

  async function serveStatic(res, pathname) {
    let rel = pathname;
    if (rel === '/') rel = '/index.html';
    else if (/^\/s\/[^/]+\/?$/.test(rel)) rel = '/player.html';
    else if (/^\/e\/[^/]+\/?$/.test(rel)) rel = '/editor.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
    let data;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    // 서비스 워커는 루트 스코프로 등록해야 하고, 항상 최신본을 확인하도록 캐시하지 않는다.
    if (rel === '/sw.js') Object.assign(headers, { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    else Object.assign(headers, { 'Cache-Control': 'no-cache' });
    send(res, 200, data, headers);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      if (url.pathname.startsWith('/photos/')) return await serveMedia(res, url, 'photos');
      if (url.pathname.startsWith('/audio/')) return await serveMedia(res, url, 'audio');
      return await serveStatic(res, url.pathname);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: '서버 오류가 발생했습니다.' });
    }
  });
}

// `node server.js` 로 직접 실행될 때만 서버를 띄운다 (테스트에서는 createApp을 import).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  // 기본은 로컬에서만 접근 가능. 현장/외부 배포 시 HOST=0.0.0.0 으로 지정한다.
  const host = process.env.HOST || '127.0.0.1';
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
  await fs.mkdir(dataDir, { recursive: true });
  createApp({ dataDir }).listen(port, host, () => {
    console.log(`Wedding Moving Poster: http://${host}:${port}  (data: ${dataDir})`);
  });
}
