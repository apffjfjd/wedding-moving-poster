// 재생기 코어: 사진 목록을 어디서 가져오든(서버 API, 구글 드라이브 등) 같은 방식으로 순환 재생한다 (FR-005).
// 동영상 렌더링 없이 브라우저에서 Web Animations API로 효과를 실시간 처리한다 (FR-002).
//
// source 인터페이스:
//   pollMs    목록 갱신 주기(ms)
//   messages  { empty, gone, offline, error } 상태별 안내 문구
//   load()    -> { status: 'ok', photos, audio? } | { status: 'gone' | 'offline' | 'error', message? }
//   photo     { id, url, width?, height?, effect, version?, fallbacks?: string[], viaFetch?: boolean }
//   audio     { url, version?, viaFetch?, cover?: photo } | null  — 배경음악 한 곡(반복 재생). 없으면 생략.
import { resolveEffect, transitionFor } from './effects.js';

import { frameRatio } from './poster.js';

import { holdMsFromSeconds } from './timing.js';

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

const safeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 저장 실패해도 재생에는 지장 없음(이번 방문 동안만 상태 유지) */
    }
  },
};

export function startPlayer({ source, stage, messageEl, hintEl, holdMs = holdMsFromSeconds() }) {
  const params = new URLSearchParams(location.search);
  // 저사양 기기용: 블러 전환·패럴랙스 같은 무거운 효과를 가벼운 효과로 대체한다. (?lite=1)
  const lite = params.get('lite') === '1';
  const ratio = frameRatio(params.get('frameWidth'), params.get('frameHeight'));
  // 포스터 구성: [CD 케이스(사진) + 케이스 뒤로 반쯤 가려진 CD] 위, 하단 문구 이미지 아래.
  // 화면 배경(#stage)에는 케이스에 나오는 사진을 흐리게 깔아 함께 바꾼다.
  const composition = document.createElement('div');
  composition.className = 'poster-composition';
  const showcase = document.createElement('div');
  showcase.className = 'showcase';
  const cdCase = document.createElement('div');
  cdCase.className = 'cd-case';
  const frame = document.createElement('div'); // 사진 슬라이드가 들어가는 케이스 안쪽 창
  frame.className = 'frame-clip';
  cdCase.append(frame);
  // CD(회전) + 고정 광택. 음악이 실제로 재생될 때만 돈다. 인쇄면 디자인은 미정(음악 이미지가 있으면 그것을 쓴다).
  const turntable = document.createElement('div');
  turntable.className = 'turntable';
  const record = document.createElement('div');
  record.className = 'record';
  record.setAttribute('role', 'img');
  record.setAttribute('aria-label', '배경음악 CD');
  const label = document.createElement('div');
  label.className = 'record-label';
  record.append(label);
  turntable.append(record);
  showcase.append(turntable, cdCase);
  const caption = makeImg(new URL('../img/caption.png', import.meta.url).href, 'caption');
  caption.alt = 'KYUDONG & SEOYOON, 2026. 10. 31 | 2:00 PM';
  composition.append(showcase, caption);
  stage.after(composition);

  const DISC = 0.9; // CD 지름 / 케이스 높이
  const DISC_OUT = 0.62; // CD 지름 중 케이스 오른쪽 밖으로 나오는 비율
  function sizePoster() {
    const room = { w: showcase.clientWidth, h: showcase.clientHeight };
    if (!room.w || !room.h) return;
    // 케이스 = 사진 창(사용자 비율) + 플라스틱 테두리. 왼쪽은 경첩만큼 더 두껍다.
    const edge = (h) => Math.max(5, 0.035 * h);
    const hinge = (h) => edge(h) * 2.4;
    const caseWidthFor = (h) => (h - 2 * edge(h)) * ratio.width / ratio.height + edge(h) + hinge(h);
    // 높이 h일 때 전체 폭 = 케이스 폭 + CD가 밖으로 나온 만큼. 둘 다 h에 비례하므로 한 번에 맞춘다.
    const widthPerHeight = caseWidthFor(100) / 100 + DISC * DISC_OUT;
    const h = Math.min(room.h, room.w / widthPerHeight);
    const w = caseWidthFor(h);
    const d = DISC * h;
    const left = (room.w - (w + d * DISC_OUT)) / 2;
    const top = (room.h - h) / 2;
    Object.assign(cdCase.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
    cdCase.style.setProperty('--edge', `${edge(h)}px`);
    cdCase.style.setProperty('--hinge', `${hinge(h)}px`);
    Object.assign(turntable.style, { width: `${d}px`, left: `${left + w + d * DISC_OUT - d}px`, top: `${top + (h - d) / 2}px` });
    // 케이스 안 여백은 반투명이라 뒤에 놓인 CD가 비쳐 보인다. 케이스에 가려지는 부분은 잘라 내 흐린 배경만 보이게 한다.
    turntable.style.clipPath = `inset(-20% -20% -20% ${d * (1 - DISC_OUT)}px)`;
  }

  new ResizeObserver(sizePoster).observe(composition);
  sizePoster();
  let coverKey = null;
  let coverSequence = 0;
  let coverBlob = null;
  async function syncCover(cover) {
    const key = cover ? `${cover.url}:${cover.version || ''}` : null;
    if (key === coverKey) return;
    coverKey = key;
    const token = ++coverSequence;
    label.replaceChildren();
    if (coverBlob) URL.revokeObjectURL(coverBlob);
    coverBlob = null;
    if (!cover) return;
    let loadedCover = null;
    for (const url of [cover.url, ...(cover.fallbacks || [])]) {
      loadedCover = await tryLoad(url, cover.viaFetch);
      if (loadedCover) break;
    }
    if (token !== coverSequence) {
      if (loadedCover?.url.startsWith('blob:')) URL.revokeObjectURL(loadedCover.url);
      return;
    }
    if (loadedCover) {
      if (loadedCover.url.startsWith('blob:')) coverBlob = loadedCover.url;
      label.append(makeImg(loadedCover.url, 'record-art'));
    } else coverKey = null; // 다음 갱신에서 재시도
  }
  const embedded = window.self !== window.top; // 편집 화면 미리보기 iframe 여부

  let photos = null; // 마지막으로 받은 사진 목록. null이면 아직 한 번도 받지 못함
  let lastId = null;
  let lastIndex = -1;
  let wakeFromEmpty = null; // 사진이 없어 대기 중일 때, 사진이 생기면 즉시 깨우는 콜백

  // ---- 배경음악 (반복 재생 1곡) ----
  // 브라우저 자동재생 정책상 사용자 입력(클릭/F 키) 전에는 소리가 나지 않을 수 있다.
  let audioEl = null;
  let audioKey = null; // 트랙 동일 여부 비교용(url:version)
  let muted = safeStorage.get('wmp:muted') === '1';
  // 편집기 미리보기(iframe)에는 버튼을 두지 않는다. 여러 미리보기가 동시에 소리를 낼 수 있어
  // 거기서는 음악을 자동재생하지 않는다(사용자 입력이 없어 브라우저가 어차피 막는다).
  let muteBtn = null;
  if (!embedded) {
    muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'audio-toggle';
    muteBtn.hidden = true;
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMuted(!muted);
      attemptPlay();
    });
    document.body.append(muteBtn);
  }

  function updateMuteBtn() {
    if (!muteBtn) return;
    muteBtn.hidden = !audioEl;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? '배경음악 켜기' : '배경음악 끄기');
  }

  function setMuted(value) {
    muted = value;
    if (audioEl) audioEl.muted = value;
    safeStorage.set('wmp:muted', value ? '1' : '0');
    updateMuteBtn();
  }

  function setSpinning(value) {
    turntable.classList.toggle('playing', value);
  }

  function attemptPlay() {
    audioEl?.play().catch(() => {
      /* 자동재생 차단: 클릭이나 F 키를 받으면 다시 시도한다 */
    });
  }

  /** 배경음악 트랙을 목록에 맞춰 바꾼다. audio가 null이면 정지·제거한다. */
  async function syncAudio(audio) {
    const key = audio ? `${audio.url}:${audio.version || ''}` : null;
    if (key === audioKey) return;
    audioKey = key;
    if (audioEl) {
      audioEl.pause();
      if (audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
      audioEl.remove();
      audioEl = null;
      setSpinning(false);
    }
    if (!audio) {
      updateMuteBtn();
      return updateHint();
    }

    let src = audio.url;
    if (audio.viaFetch) {
      try {
        const res = await fetch(audio.url, { mode: 'cors' });
        if (!res.ok) return updateMuteBtn();
        src = URL.createObjectURL(await res.blob());
      } catch {
        return updateMuteBtn(); // 못 불러오면 조용히 포기(음악 없이 재생은 계속된다)
      }
    }
    if (key !== audioKey) return; // 받는 동안 목록이 또 바뀜: 최신 것만 반영
    audioEl = document.createElement('audio');
    audioEl.loop = true;
    audioEl.muted = muted;
    audioEl.src = src;
    audioEl.style.display = 'none';
    const el = audioEl;
    el.addEventListener('playing', () => el === audioEl && setSpinning(true));
    for (const type of ['pause', 'ended', 'emptied']) {
      el.addEventListener(type, () => el === audioEl && setSpinning(false));
    }
    // 미리보기 iframe은 소리를 내지 않으므로, 음악이 등록돼 있으면 재생 중인 모습으로 보여 준다.
    if (embedded) setSpinning(true);
    document.body.append(audioEl);
    updateMuteBtn();
    updateHint();
    attemptPlay();
  }

  function updateHint() {
    if (!hintEl) return;
    hintEl.textContent = audioEl
      ? '클릭하거나 F 키를 눌러 전체화면·배경음악을 재생하세요'
      : '클릭하거나 F 키를 눌러 전체화면으로 재생하세요';
  }

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
      syncCover(result.audio?.cover || null);
      syncAudio(result.audio || null);
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

  /** 사진 하나를 화면에 올리고 등장 전환을 시작한다. */
  function present(photo, index) {
    // 원본은 케이스 안에 잘림 없이 고정한다. 케이스 비율과 달라 남는 여백은 비워 두어
    // .frame-clip의 반투명 바탕 너머로 화면 배경(같은 사진의 블러)이 비쳐 보이게 한다.
    const effect = resolveEffect(photo, index, { lite });

    // 화면 배경: 같은 사진을 흐리게 확대해 깔고, 새 배경이 이전 배경 위로 서서히 나타난다.
    const backdrop = makeImg(photo.url, 'backdrop');
    const previousBackdrops = [...stage.children];
    stage.append(backdrop);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TRANS_MS, easing: 'ease-in-out', fill: 'both' });

    const photoSlide = document.createElement('div');
    photoSlide.className = 'photo-slide';
    photoSlide.dataset.photoId = photo.id; // 디버깅/자동 검증용
    photoSlide.dataset.effect = effect;
    photoSlide.append(makeImg(photo.url, 'fg'));

    const previous = [...frame.children];
    frame.append(photoSlide);

    const t = transitionFor(effect);
    photoSlide.animate(t.enter, {
      duration: TRANS_MS * (1 - t.enterDelayRatio),
      delay: TRANS_MS * t.enterDelayRatio,
      easing: 'ease-in-out',
      fill: 'both',
    });
    // 여백이 비쳐 보이므로 새 사진이 이전 사진을 덮지 못한다. 이전 사진도 항상 함께 사라지게 한다.
    const fadeOutMs = t.fadeOutPrev ? TRANS_MS * t.enterDelayRatio : TRANS_MS;
    previous.forEach((el) =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeOutMs, easing: 'ease-in', fill: 'forwards' }),
    );

    // 전환이 끝나면 이전 사진·배경을 제거해 메모리를 회수한다.
    return sleep(TRANS_MS).then(() => [...previous, ...previousBackdrops].forEach((el) => el.remove()));
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
        frame.replaceChildren();
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
      await sleep(holdMs);
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
    // 전체화면 켜는 클릭/F 키는 브라우저가 인정하는 사용자 입력이므로, 배경음악 자동재생 차단도 함께 풀린다.
    document.addEventListener('click', () => {
      toggleFullscreen();
      attemptPlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
        attemptPlay();
      }
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
