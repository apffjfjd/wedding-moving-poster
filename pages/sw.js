// 서비스 워커(Pages 모드): 결혼식장 네트워크가 불안정하거나 끊겨도 한 번 재생한 슬라이드쇼를 계속 재생한다.
// - 드라이브 사진 목록/재생 페이지/코드: 네트워크 우선, 실패 시 마지막 캐시
// - 사진 이미지: 캐시 우선 (재생기가 CORS fetch로 받으므로 성공 응답만 안전하게 캐시된다)
const CACHE = 'wmp-pages-v1';
const scope = self.registration.scope;
const SHELL = ['js/effects.js', 'js/player-core.js', 'js/drive-source.js', 'js/drive-player.js', 'config.js', 'css/player.css'].map(
  (p) => new URL(p, scope).pathname,
);
const PLAYER_PATH = new URL('player.html', scope).pathname;

self.addEventListener('install', (event) => {
  // 코드 파일을 미리 캐시해 두면, 첫 방문 직후 오프라인이 되어도 새로고침할 수 있다.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, timeoutMs) {
  const cache = await caches.open(CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    if (url.pathname === PLAYER_PATH) event.respondWith(networkFirst(request, 4000));
    else if (SHELL.includes(url.pathname)) event.respondWith(networkFirst(request, 1500));
    return;
  }

  // 외부 도메인은 재생기가 CORS fetch로 요청한 것(드라이브 목록·사진)만 다룬다.
  // 목록/폴더 조회(/drive/v3/files)는 최신 우선, 사진 바이트는 캐시 우선.
  if (request.mode !== 'cors') return;
  const isListing = url.pathname.includes('/drive/v3/files') && url.searchParams.get('alt') !== 'media';
  event.respondWith(isListing ? networkFirst(request, 4000) : cacheFirst(request));
});
