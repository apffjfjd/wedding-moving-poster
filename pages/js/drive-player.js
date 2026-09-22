// GitHub Pages 재생 화면: player.html?folder=<사진 폴더 ID>&bgm=<배경음악 폴더 ID(선택)>
// 두 폴더는 완전히 별개의 드라이브 폴더다 — 사진과 배경음악을 각각 독립적으로 공유·교체할 수 있다.
import { startPlayer } from './player-core.js';
import { createDriveSource, parseFolderId } from './drive-source.js';
import { config } from '../config.js';

const stage = document.getElementById('stage');
const messageEl = document.getElementById('message');
const hintEl = document.getElementById('hint');

const searchParams = new URLSearchParams(location.search);
const folderId = parseFolderId(searchParams.get('folder'));
const bgmParam = searchParams.get('bgm');
const bgmFolderId = bgmParam ? parseFolderId(bgmParam) : null; // 링크가 있는데 못 읽으면 조용히 음악 없이 진행

if (!folderId) {
  hintEl.remove();
  messageEl.textContent = '주소에 사진 폴더 정보가 없습니다.\n처음 화면에서 재생 URL을 다시 만들어 주세요.';
  messageEl.hidden = false;
} else {
  const player = startPlayer({ source: createDriveSource({ folderId, bgmFolderId, config }), stage, messageEl, hintEl });
  // 오프라인 대비: 한 번 재생한 목록과 사진을 서비스 워커가 캐시한다. (HTTPS 또는 localhost에서만 동작)
  // 첫 방문에서는 서비스 워커가 활성화되기 전에 페이지/목록을 받았으므로, 활성화 직후 다시 요청해 캐시에 담는다.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.ready.then(() => {
      fetch(location.href).catch(() => {});
      player.refresh();
    });
  }
}
