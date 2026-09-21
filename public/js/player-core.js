// 재생기 코어: 사진 목록을 어디서 가져오든(서버 API, 구글 드라이브 등) 같은 방식으로 순환 재생한다 (FR-005).
// 동영상 렌더링 없이 브라우저에서 Web Animations API로 효과를 실시간 처리한다 (FR-002).
//
// source 인터페이스:
//   pollMs    목록 갱신 주기(ms)
//   messages  { empty, gone, offline, error } 상태별 안내 문구
//   load()    -> { status: 'ok', photos } | { status: 'gone' | 'offline' | 'error', message? }
//   photo     { id, url, width?, height?, effect, version?, fallbacks?: string[], viaFetch?: boolean }
import { resolveEffect, layoutFor, motionFor, transitionFor, MOTION_EASING } from './effects.js';

const HOLD_MS = 5000; // 사진이 정지해 보이는 시간
const TRANS_MS = 1600; // 다음 사진으로 넘어가는 전환 시간
const EMPTY_POLL_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 이미지를 불러와 실제 크기를 얻는다. 실패하면 null. */
function probe(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function tryLoad(url, viaFetch) {
  let src = url;
  if (viaFetch) {
    // 외부 도메인 이미지는 CORS fetch로 받아 두면 서비스 워커가 안전하게 캐시(오프라인 재생)할 수 있다.
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      src = URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }
  const dims = await probe(src);
  if (!dims) {
    if (viaFetch) URL.revokeObjectURL(src);
    return null;
  }
  return { url: src, ...dims };
}

export function startPlayer({ source, stage, messageEl, hintEl }) {
  const params = new URLSearchParams(location.search);
  // 저사양 기기용: 블러 전환·패럴랙스 같은 무거운 효과를 가벼운 효과로 대체한다. (?lite=1)
  const lite = params.get('lite') === '1';
  const embedded = window.self !== window.top; // 편집 화면 미리보기 iframe 여부

  let photos = null; // 마지막으로 받은 사진 목록. null이면 아직 한 번도 받지 못함
  let lastId = null;
  let lastIndex = -1;
  let sequence = 0; // 슬라이드 방향(팬/Ken Burns 좌우 번갈아)용 누적 카운터
  let wakeFromEmpty = null; // 사진이 없어 대기 중일 때, 사진이 생기면 즉시 깨우는 콜백

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
  }
  const hideMessage = () => {
    messageEl.hidden = true;
  };

  /** 목록을 갱신한다. 실패하면 마지막 목록을 유지한다(현장 네트워크 불안정 대비). */
  async function refresh() {
    const result = await source.load();
    if (result.status === 'ok') {
      photos = result.photos;
      if (photos.length) {
        wakeFromEmpty?.();
        warmUp();
      }
    }
    return result;
  }

  // 전체 사진을 백그라운드로 미리 받아 둔다. 한 바퀴 돌기 전에 네트워크가 끊겨도
  // 서비스 워커 캐시에 모든 사진이 들어 있게 하고, 전환 시 로딩 지연도 없앤다.
  let warming = false;
  async function warmUp() {
    if (warming) return;
    warming = true;
    try {
      for (const photo of [...photos]) {
        await loadPhoto(photo);
        await sleep(150);
      }
    } finally {
      warming = false;
    }
  }

  // 불러오기 결과 캐시. 여러 전략(url, fallbacks) 중 마지막으로 성공한 것부터 시도한다.
  const loaded = new Map();
  let preferred = 0;
  function loadPhoto(photo) {
    const key = `${photo.id}:${photo.version || ''}`;
    if (!loaded.has(key)) {
      const promise = (async () => {
        const urls = [photo.url, ...(photo.fallbacks || [])];
        for (let i = 0; i < urls.length; i++) {
          const idx = (preferred + i) % urls.length;
          const result = await tryLoad(urls[idx], photo.viaFetch);
          if (result) {
            preferred = idx;
            return result;
          }
        }
        return null;
      })();
      loaded.set(key, promise);
      promise.then((result) => result || loaded.delete(key)); // 실패한 것은 다음에 다시 시도
    }
    return loaded.get(key);
  }

  function makeImg(url, cls) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = url;
    img.alt = '';
    img.draggable = false;
    return img;
  }

  /** 사진 하나를 화면에 올리고 등장 전환 + 정지 구간 모션을 시작한다. */
  function present(photo, index) {
    // 실제로 불러온 이미지 크기 기준으로 비율을 판정한다 (EXIF 회전이 반영된 값)
    const effect = resolveEffect(photo, index, { lite });
    const layout = layoutFor(photo.width, photo.height, stage.clientWidth, stage.clientHeight);
    const flip = sequence++ % 2 === 1;

    const slide = document.createElement('div');
    slide.className = `slide ${layout}`;
    slide.dataset.photoId = photo.id; // 디버깅/자동 검증용
    slide.dataset.effect = effect;
    const mv = document.createElement('div');
    mv.className = 'mv';
    const bg = layout === 'blur-contain' ? makeImg(photo.url, 'bg') : null;
    const fg = makeImg(photo.url, 'fg');
    if (bg) mv.append(bg);
    mv.append(fg);
    slide.append(mv);

    const previous = [...stage.children];
    stage.append(slide);

    const motion = motionFor(effect, flip);
    const motionOpts = { duration: HOLD_MS + TRANS_MS * 2, easing: MOTION_EASING, fill: 'forwards' };
    if (motion.mv) mv.animate(motion.mv, motionOpts);
    if (motion.fg) fg.animate(motion.fg, motionOpts);
    if (motion.bg && bg) bg.animate(motion.bg, motionOpts);

    const t = transitionFor(effect);
    slide.animate(t.enter, {
      duration: TRANS_MS * (1 - t.enterDelayRatio),
      delay: TRANS_MS * t.enterDelayRatio,
      easing: 'ease-in-out',
      fill: 'both',
    });
    if (t.fadeOutPrev) {
      previous.forEach((el) =>
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TRANS_MS * t.enterDelayRatio, easing: 'ease-in', fill: 'forwards' }),
      );
    }

    // 전환이 끝나 새 사진이 화면을 완전히 덮으면 이전 슬라이드를 제거해 메모리를 회수한다.
    return sleep(TRANS_MS).then(() => previous.forEach((el) => el.remove()));
  }

  /** 다음에 보여 줄 사진의 인덱스. 재생 중 사진이 추가/삭제돼도 흐름이 자연스럽게 이어지게 한다. */
  function pickNextIndex() {
    let i;
    const currentPos = lastId ? photos.findIndex((p) => p.id === lastId) : -1;
    if (currentPos >= 0) i = currentPos + 1;
    else i = lastIndex + 1 - (lastId ? 1 : 0); // 방금 보여 준 사진이 삭제됨: 같은 자리에서 이어감
    if (i < 0 || i >= photos.length) i = 0; // 마지막 다음은 처음으로 (무한 반복)
    return i;
  }

  async function run() {
    let result = await refresh();
    while (!photos) {
      showMessage(result.message || source.messages[result.status] || source.messages.offline);
      await sleep(5000);
      result = await refresh();
    }
    hideMessage();

    let failures = 0;
    for (;;) {
      if (!photos.length) {
        stage.replaceChildren();
        lastId = null;
        lastIndex = -1;
        showMessage(source.messages.empty);
        await Promise.race([sleep(EMPTY_POLL_MS), new Promise((resolve) => (wakeFromEmpty = resolve))]);
        wakeFromEmpty = null;
        await refresh();
        continue;
      }
      hideMessage();

      const index = pickNextIndex();
      const photo = photos[index];
      const loadedPhoto = await loadPhoto(photo);
      if (!loadedPhoto) {
        // 불러오지 못한 사진은 건너뛴다. 전부 실패하면 잠시 쉬었다가 다시 시도한다.
        lastId = photo.id;
        lastIndex = index;
        if (++failures >= photos.length) {
          failures = 0;
          await sleep(5000);
          await refresh();
        }
        continue;
      }
      failures = 0;

      // 다음 사진을 미리 받아 두어 전환 시 끊김이 없게 한다.
      const upcoming = photos[(index + 1) % photos.length];
      if (upcoming) loadPhoto(upcoming);

      lastId = photo.id;
      lastIndex = index;
      await present({ ...photo, url: loadedPhoto.url, width: loadedPhoto.width, height: loadedPhoto.height }, index);
      await sleep(HOLD_MS);
    }
  }

  // ---- 사진/설정 변경 반영 (비즈니스 규칙 4) ----
  setInterval(refresh, source.pollMs || 10000);

  // ---- 전체화면 / 화면 꺼짐 방지 / 커서 숨김 ----
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  if (embedded) {
    hintEl?.remove();
  } else {
    document.addEventListener('click', toggleFullscreen);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
    setTimeout(() => hintEl?.classList.add('gone'), 6000);
    document.addEventListener('fullscreenchange', () => hintEl?.classList.add('gone'));
  }

  let idleTimer;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
  });

  async function keepAwake() {
    try {
      await navigator.wakeLock?.request('screen');
    } catch {
      /* 지원하지 않거나 거부되면 무시 */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });
  keepAwake();

  run();
  return { refresh };
}
