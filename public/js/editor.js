// 편집기: 사진 업로드(FR-001), 비율 감지 표시(FR-003), 효과 지정(FR-002), URL 안내(FR-004)
import { EFFECTS, orientationOf } from '/js/effects.js';

const MAX_SIDE = 1920; // 고해상도 원본을 그대로 쓰면 로딩/메모리 부담이 크므로 업로드 전에 축소한다.
const JPEG_QUALITY = 0.86;

const showId = location.pathname.split('/')[2];
const $ = (id) => document.getElementById(id);
const STORE = 'wmp:shows';

// 편집 키: 발급 직후 URL 해시(#key=...) → localStorage 순으로 찾는다.
function findKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('key');
  if (fromHash) return fromHash;
  try {
    return (JSON.parse(localStorage.getItem(STORE) || '[]').find((s) => s.id === showId) || {}).key || null;
  } catch {
    return null;
  }
}

function rememberKey(key) {
  try {
    const shows = JSON.parse(localStorage.getItem(STORE) || '[]');
    if (!shows.some((s) => s.id === showId)) {
      shows.unshift({ id: showId, key, createdAt: Date.now() });
      localStorage.setItem(STORE, JSON.stringify(shows));
    }
  } catch {
    /* 무시 */
  }
}

const editKey = findKey();
let photos = [];

async function api(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`/api/slideshows/${showId}${path}`, {
    method,
    headers: { 'x-edit-key': editKey || '', ...headers },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `요청에 실패했습니다 (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* 본문 없음 */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const previewFrame = $('preview');
const refreshPreview = () => previewFrame.contentWindow?.postMessage('wmp:refresh', location.origin);

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// ---- 화면 그리기 ----
function render() {
  $('count').textContent = `(${photos.length}장)`;
  const grid = $('grid');
  grid.replaceChildren();

  photos.forEach((photo, i) => {
    const card = document.createElement('div');
    card.className = 'photo';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = `사진 ${i + 1}`;
    img.loading = 'lazy';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = orientationOf(photo.width, photo.height) === 'portrait' ? '세로' : '가로';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1);
    thumb.append(img, badge, idx);

    const ctl = document.createElement('div');
    ctl.className = 'ctl';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `사진 ${i + 1} 전환 효과`);
    for (const effect of EFFECTS) {
      const option = document.createElement('option');
      option.value = effect.id;
      option.textContent = effect.label;
      option.selected = effect.id === photo.effect;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      const previous = photo.effect;
      try {
        await api('PATCH', `/photos/${photo.id}`, { body: JSON.stringify({ effect: select.value }) });
        photo.effect = select.value;
        refreshPreview();
      } catch (err) {
        select.value = previous;
        setStatus(err.message, true);
      }
    });

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '삭제';
    del.setAttribute('aria-label', `사진 ${i + 1} 삭제`);
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        const view = await api('DELETE', `/photos/${photo.id}`);
        photos = view.photos;
        render();
        refreshPreview();
      } catch (err) {
        del.disabled = false;
        setStatus(err.message, true);
      }
    });

    ctl.append(select, del);
    card.append(thumb, ctl);
    grid.append(card);
  });
}

// ---- 업로드: 브라우저에서 축소·JPEG 변환 후 전송 ----
async function prepare(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // EXIF 회전 반영
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('이미지를 변환하지 못했습니다.');
  return { blob, width, height };
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return setStatus('이미지 파일을 선택해 주세요.', true);

  const failed = [];
  setStatus(`업로드 중… 0/${files.length}`);

  // 재생 순서 = 업로드 순서이므로, 선택한 파일 순서를 지키도록 하나씩 순차 업로드한다.
  for (const [i, file] of files.entries()) {
    try {
      const { blob, width, height } = await prepare(file);
      const photo = await api('POST', '/photos', {
        body: blob,
        headers: { 'Content-Type': 'image/jpeg', 'x-photo-width': String(width), 'x-photo-height': String(height) },
      });
      photos.push(photo);
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
    setStatus(`업로드 중… ${i + 1}/${files.length}`);
  }

  render();
  refreshPreview();
  if (failed.length) setStatus(`${files.length - failed.length}장 업로드, ${failed.length}장 실패 — ${failed.join(' / ')}`, true);
  else setStatus(`${files.length}장을 업로드했습니다.`);
}

function setupUpload() {
  const drop = $('drop');
  const input = $('file');
  input.addEventListener('change', () => {
    uploadFiles(input.files);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }),
  );
  drop.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
}

function setupLinks() {
  const playUrl = `${location.origin}/s/${showId}`;
  const editUrl = `${location.origin}/e/${showId}#key=${editKey}`;
  $('playUrl').value = playUrl;
  $('editUrl').value = editUrl;
  $('openPlay').href = playUrl;
  document.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const input = $(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      const label = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(() => (btn.textContent = label), 1200);
    }),
  );
}

function setupRemove() {
  $('remove').addEventListener('click', async () => {
    if (!confirm('사진과 설정이 모두 삭제되며 되돌릴 수 없습니다. 삭제할까요?')) return;
    try {
      await api('DELETE', '');
      try {
        const shows = JSON.parse(localStorage.getItem(STORE) || '[]').filter((s) => s.id !== showId);
        localStorage.setItem(STORE, JSON.stringify(shows));
      } catch {
        /* 무시 */
      }
      location.href = '/';
    } catch (err) {
      setStatus(err.message, true);
    }
  });
}

async function init() {
  if (!editKey) return ($('denied').hidden = false);
  try {
    await api('GET', '/auth');
  } catch {
    return ($('denied').hidden = false);
  }
  rememberKey(editKey);
  $('app').hidden = false;
  setupLinks();
  setupUpload();
  setupRemove();
  previewFrame.src = `/s/${showId}`;
  photos = (await api('GET', '')).photos;
  render();
}

init().catch((err) => {
  $('denied').textContent = err.message;
  $('denied').hidden = false;
});
