// 서비스 워커: 결혼식장 네트워크가 불안정하거나 끊겨도 한 번 재생한 슬라이드쇼를 계속 재생한다.
// - 정적 자원/사진: 캐시 우선 (사진 파일명은 불변이므로 안전)
// - 슬라이드쇼 메타데이터/재생 페이지: 네트워크 우선, 실패 시 마지막 캐시 사용
const CACHE = 'wmp-v2';
const SHELL = ['/js/effects.js', '/js/player-core.js', '/js/player.js', '/css/player.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.origin !== location.origin) return;

  if (/^\/api\/slideshows\/[^/]+$/.test(url.pathname) || /^\/s\/[^/]+\/?$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, 4000));
  } else if (SHELL.includes(url.pathname)) {
    // 코드 갱신은 반영하되 오프라인에서는 캐시로 동작한다.
    event.respondWith(networkFirst(request, 1500));
  } else if (url.pathname.startsWith('/photos/')) {
    event.respondWith(cacheFirst(request));
  }
});
