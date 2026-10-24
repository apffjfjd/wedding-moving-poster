// 재생기 코어: 사진 목록을 어디서 가져오든(서버 API, 구글 드라이브 등) 같은 방식으로 순환 재생한다 (FR-005).
// 동영상 렌더링 없이 브라우저에서 Web Animations API로 효과를 실시간 처리한다 (FR-002).
//
// source 인터페이스:
//   pollMs    목록 갱신 주기(ms)
//   messages  { empty, gone, offline, error } 상태별 안내 문구
//   load()    -> { status: 'ok', photos, audio? } | { status: 'gone' | 'offline' | 'error', message? }
//   photo     { id, url, width?, height?, effect, version?, fallbacks?: string[], viaFetch?: boolean }
//   audio     { url, version?, viaFetch?, cover?: photo } | null  — 배경음악 한 곡(반복 재생). 없으면 생략.
//   background  photo | null  — 화면 배경 이미지. 없으면 흰 배경.
import { resolveEffect, transitionFor } from './effects.js';

import { frameRatio, framePath } from './poster.js';

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
  const composition = document.createElement('div');
  composition.className = 'poster-composition';
  const frameSlot = document.createElement('div');
  frameSlot.className = 'photo-slot';
  // 액자: 그림자(뒤) > 사진(액자 윤곽으로 잘라냄) > 테두리(앞)
  const frameBox = document.createElement('div');
  frameBox.className = 'photo-frame';
  const svgLayer = (cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  };
  const frameShadow = svgLayer('frame-shadow');
  const frame = document.createElement('div'); // 사진 슬라이드가 들어가는 곳
  frame.className = 'frame-clip';
  const frameBorder = svgLayer('frame-border');
  frameBox.append(frameShadow, frame, frameBorder);
  frameSlot.append(frameBox);
  const recordSlot = document.createElement('div');
  recordSlot.className = 'record-slot';
  // LP(회전) + 고정 광택. 음악이 실제로 재생될 때만 돈다.
  const turntable = document.createElement('div');
  turntable.className = 'turntable';
  const record = document.createElement('div');
  record.className = 'record';
  record.setAttribute('role', 'img');
  record.setAttribute('aria-label', '배경음악 LP');
  const label = document.createElement('div');
  label.className = 'record-label';
  record.append(label);
  turntable.append(record);
  recordSlot.append(turntable);
  composition.append(frameSlot, recordSlot);
  stage.after(composition);
  function sizePoster() {
    const width = Math.min(frameSlot.clientWidth, frameSlot.clientHeight * ratio.width / ratio.height) * 0.85;
    const height = width * ratio.height / ratio.width;
    frameBox.style.width = `${width}px`;
    frameBox.style.height = `${height}px`;
    drawFrame(width, height);
    turntable.style.width = `${Math.min(recordSlot.clientWidth, recordSlot.clientHeight) * 0.82}px`;
  }
  /** 액자 크기가 바뀔 때마다 윤곽·테두리를 다시 그린다. 기본색 #FDE3C7(샴페인 피치) 계열. */
  function drawFrame(w, h) {
    if (!w || !h) return;
    const u = Math.min(w, h);
    const s = (k, min = 0) => Math.max(min, k * u).toFixed(2);
    const m = Math.max(6, 0.03 * u); // 테두리선 위치(번짐·반딧불이 들어갈 여백)
    const outline = framePath(w, h, m);
    frame.style.clipPath = `path('${outline}')`;
    const rand = seeded(7); // 크기가 바뀌어도 같은 무늬가 나오도록 고정 시드

    frameShadow.setAttribute('viewBox', `0 0 ${w} ${h}`);
    frameShadow.innerHTML = `
      <defs>
        <filter id="wmp-frame-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${s(0.025)}"/></filter>
        <mask id="wmp-frame-outside" maskUnits="userSpaceOnUse" x="${-w}" y="${-h}" width="${w * 3}" height="${h * 3}">
          <rect x="${-w}" y="${-h}" width="${w * 3}" height="${h * 3}" fill="#fff"/><path d="${outline}" fill="#000"/>
        </mask>
      </defs>
      <g mask="url(#wmp-frame-outside)">
        <path d="${outline}" transform="translate(0 ${s(0.018)})" fill="#6b4226" fill-opacity="0.22" filter="url(#wmp-frame-shadow)"/>
      </g>`;

    // 반딧불이 지나간 자리: 아주 가는 빛줄기가 군데군데 끊기고 밝기가 고르지 않으며, 살짝 일렁인다.
    // 끊김 무늬가 다른 선 세 겹을 겹쳐 밝기 차이를 만들고, 난류 변위 필터로 선을 불규칙하게 흔든다.
    const wobble = s(0.013, 3);
    const trace = (dash, stroke, width, opacity, inset = m, filter = 'wmp-frame-wobble') => `
      <path d="${framePath(w, h, inset)}" pathLength="1000" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}"
        stroke-linecap="round" stroke-dasharray="${dash}" filter="url(#${filter})"/>`;
    // 가는 빛줄기 아래에 옅은 갈색 그늘선을 같은 무늬로 깔아, 흰 배경에서도 윤곽이 읽히게 한다.
    const mainDash = dashes(rand, [30, 160], [2, 18]);
    frameBorder.setAttribute('viewBox', `0 0 ${w} ${h}`);
    frameBorder.innerHTML = `
      <defs>
        <filter id="wmp-frame-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="${(0.9 / u).toFixed(4)} ${(1.3 / u).toFixed(4)}" numOctaves="2" seed="3"/>
          <feDisplacementMap in="SourceGraphic" scale="${wobble}" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="wmp-frame-haze" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="${(0.9 / u).toFixed(4)} ${(1.3 / u).toFixed(4)}" numOctaves="2" seed="3"/>
          <feDisplacementMap in="SourceGraphic" scale="${wobble}" xChannelSelector="R" yChannelSelector="G" result="moved"/>
          <feGaussianBlur in="moved" stdDeviation="${s(0.006, 2)}"/>
        </filter>
        <filter id="wmp-frame-inner" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${s(0.02, 3)}"/></filter>
        <clipPath id="wmp-frame-inside"><path d="${outline}"/></clipPath>
      </defs>
      <path d="${outline}" fill="none" stroke="#FDE3C7" stroke-opacity="0.35" stroke-width="${s(0.04)}" filter="url(#wmp-frame-inner)" clip-path="url(#wmp-frame-inside)"/>
      ${trace(dashes(rand, [40, 140], [10, 60]), '#FDE3C7', s(0.011, 3.5), 0.75, m, 'wmp-frame-haze')}
      ${trace(mainDash, '#8a5a34', s(0.004, 1.6), 0.3, m, 'wmp-frame-haze')}
      ${trace(mainDash, '#fff3e2', s(0.0022, 0.9), 1)}
      ${trace(dashes(rand, [8, 60], [6, 40]), '#f5cfa6', s(0.0016, 0.7), 0.75, m + Math.max(1.5, 0.006 * u))}`;

    // 반딧불: 테두리 주변에 크기·밝기가 제각각인 작은 빛 알갱이를 흩어 둔다(움직이지 않음).
    const measure = frameBorder.querySelector('clipPath path'); // 액자 윤곽 그대로
    const total = measure.getTotalLength();
    const flies = [];
    const count = Math.round(total / Math.max(28, 0.09 * u));
    for (let k = 0; k < count; k++) {
      const at = ((k + rand() * 0.8) / count) * total;
      const p = measure.getPointAtLength(at);
      const q = measure.getPointAtLength(Math.min(total, at + 1));
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const off = (rand() - 0.5) * Math.max(6, 0.03 * u); // 선 양옆으로 조금씩 벗어나게
      flies.push({
        x: p.x - ((q.y - p.y) / len) * off,
        y: p.y + ((q.x - p.x) / len) * off,
        r: Math.max(2, 0.009 * u) * (0.5 + rand()),
        opacity: 0.45 + rand() * 0.55,
      });
    }

    frameBorder.insertAdjacentHTML('beforeend', `
      <defs>
        <radialGradient id="wmp-firefly">
          <stop offset="0" stop-color="#fffaf0"/>
          <stop offset="0.12" stop-color="#ffd9ad"/>
          <stop offset="0.4" stop-color="#f6c696" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#FDE3C7" stop-opacity="0"/>
        </radialGradient>
      </defs>
      ${flies.map((f) => `<circle cx="${f.x.toFixed(2)}" cy="${f.y.toFixed(2)}" r="${(f.r * 3).toFixed(2)}" fill="url(#wmp-firefly)" opacity="${f.opacity.toFixed(2)}"/>`).join('')}`);
  }

  /** 고정 시드 난수(0~1). 테두리의 불규칙한 무늬가 매번 같게 나오게 한다. */
  function seeded(seed) {
    let t = seed;
    return () => {
      t = (t + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** pathLength 1000 기준의 불규칙한 끊김 무늬(선 길이·틈 길이 범위 안에서 무작위) */
  function dashes(rand, [dashMin, dashMax], [gapMin, gapMax]) {
    const parts = [];
    for (let sum = 0; sum < 1000; ) {
      const dash = dashMin + rand() * (dashMax - dashMin);
      const gap = gapMin + rand() * (gapMax - gapMin);
      parts.push(dash.toFixed(1), gap.toFixed(1));
      sum += dash + gap;
    }
    return parts.join(' ');
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
  // 화면 배경은 stage에 한 장만 깐다. 없으면 stage의 흰 배경이 그대로 보인다.
  let backgroundKey = null;
  let backgroundSequence = 0;
  let backgroundBlob = null;
  async function syncBackground(background) {
    const key = background ? `${background.url}:${background.version || ''}` : null;
    if (key === backgroundKey) return;
    backgroundKey = key;
    const token = ++backgroundSequence;
    let loadedBackground = null;
    for (const url of background ? [background.url, ...(background.fallbacks || [])] : []) {
      loadedBackground = await tryLoad(url, background.viaFetch);
      if (loadedBackground) break;
    }
    if (token !== backgroundSequence) {
      if (loadedBackground?.url.startsWith('blob:')) URL.revokeObjectURL(loadedBackground.url);
      return;
    }
    if (background && !loadedBackground) {
      backgroundKey = null; // 다음 갱신에서 재시도(그동안 이전 배경 유지)
      return;
    }
    stage.replaceChildren(...(loadedBackground ? [makeImg(loadedBackground.url, 'backdrop')] : []));
    if (backgroundBlob) URL.revokeObjectURL(backgroundBlob);
    backgroundBlob = loadedBackground?.url.startsWith('blob:') ? loadedBackground.url : null;
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
      syncBackground(result.background || null);
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
    // 원본은 프레임 안에 잘림 없이 고정한다. 프레임 비율과 달라 남는 여백은 비워 두어
    // .frame-clip의 반투명 바탕 너머로 화면 배경이 비쳐 보이게 한다.
    const effect = resolveEffect(photo, index, { lite });

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

    // 전환이 끝나 새 사진이 프레임을 완전히 덮으면 이전 슬라이드를 제거해 메모리를 회수한다.
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
        frame.replaceChildren();
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
