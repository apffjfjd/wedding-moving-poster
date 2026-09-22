// 서버(Node) 모드 재생기: 사진 목록을 이 서버의 API에서 가져온다.
import { startPlayer } from './player-core.js';

const showId = location.pathname.split('/')[2];

const source = {
  pollMs: 10000, // 사진/설정 변경 반영 주기
  messages: {
    empty: '아직 등록된 사진이 없습니다.\n편집 화면에서 사진을 업로드해 주세요.',
    gone: '슬라이드쇼를 찾을 수 없습니다.\nURL을 다시 확인해 주세요.',
    offline: '네트워크에 연결할 수 없습니다.\n연결되면 자동으로 재생됩니다.',
    error: '슬라이드쇼를 불러오지 못했습니다.',
  },
  async load() {
    try {
      const res = await fetch(`/api/slideshows/${showId}`, { cache: 'no-store' });
      if (res.status === 404) return { status: 'gone' };
      if (!res.ok) return { status: 'offline' };
      const meta = await res.json();
      return { status: 'ok', photos: meta.photos, audio: meta.audio ? { url: meta.audio.url, version: meta.audio.url } : null };
    } catch {
      return { status: 'offline' }; // 현장 네트워크 불안정: 마지막으로 받은 목록으로 계속 재생한다.
    }
  },
};

const player = startPlayer({
  source,
  stage: document.getElementById('stage'),
  messageEl: document.getElementById('message'),
  hintEl: document.getElementById('hint'),
});

// 편집 화면 미리보기(iframe)가 변경 직후 즉시 갱신을 요청한다.
window.addEventListener('message', (event) => {
  if (event.origin === location.origin && event.data === 'wmp:refresh') player.refresh();
});

// 오프라인 대비: 한 번 재생한 콘텐츠를 서비스 워커가 캐시한다.
// 첫 방문에서는 서비스 워커가 활성화되기 전에 페이지/목록을 받았으므로, 활성화 직후 다시 요청해 캐시에 담는다.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => {
    fetch(location.href).catch(() => {});
    player.refresh();
  });
}
