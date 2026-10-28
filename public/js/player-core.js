// 재생기 코어: 사진 목록을 어디서 가져오든(서버 API, 구글 드라이브 등) 같은 방식으로 순환 재생한다 (FR-005).
// 동영상 렌더링 없이 브라우저에서 Web Animations API로 효과를 실시간 처리한다 (FR-002).
//
// source 인터페이스:
//   pollMs    목록 갱신 주기(ms)
//   messages  { empty, gone, offline, error } 상태별 안내 문구
//   load()    -> { status: 'ok', photos, audio? } | { status: 'gone' | 'offline' | 'error', message? }
//   photo     { id, url, width?, height?, effect, anchor?, version?, fallbacks?: string[], viaFetch?: boolean }
//   audio     track | track[] | null  — 배경음악. track = { url, version?, viaFetch?, cover?: photo }
//             목록이면 차례로, 한 곡이면 반복 재생하며 곡이 넘어갈 때마다 CD 교체 연출을 거친다.
import { resolveEffect, transitionFor, anchorPosition } from './effects.js';

import { holdMsFromSeconds } from './timing.js';

const TRANS_MS = 1600; // 다음 사진으로 넘어가는 전환 시간
// 배경음악이 넘어갈 때의 CD 연출: 서서히 멈춤 → 케이스 안으로 → 잠시 쉼(다음 곡 준비) → 새 CD가 나옴 → 돌면서 재생
const SPIN_MS = 3200; // CD 한 바퀴
const SPIN_UP_MS = 700;
const STOP_MS = 900;
const SLIDE_MS = 1300;
const PAUSE_MS = 600;
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
  // 포스터 구성: [CD 케이스 뒷면 < CD < 앞면(사진)] 위, 하단 문구 이미지 아래.
  // 뒷면은 앞면보다 오른쪽으로 길게 빠져나와 케이스 입구를 드러내고, CD는 그 사이에서 나온다.
  // 화면 배경(#stage)에는 케이스에 나오는 사진을 흐리게 깔아 함께 바꾼다.
  const composition = document.createElement('div');
  composition.className = 'poster-composition';
  const showcase = document.createElement('div');
  showcase.className = 'showcase';
  // 흰색 불투명 케이스. 노치 모양으로 잘라 내면(clip-path) 그림자도 잘리므로, 그림자는 바깥 래퍼(filter)에 준다.
  const caseBack = document.createElement('div');
  caseBack.className = 'cd-case-back';
  const caseShadow = document.createElement('div');
  caseShadow.className = 'cd-case-shadow';
  const cdCase = document.createElement('div');
  cdCase.className = 'cd-case';
  const frame = document.createElement('div'); // 사진 슬라이드가 들어가는 창(좌우 끝까지, 위아래 여백)
  frame.className = 'frame-clip';
  const notchRim = document.createElement('div'); // 노치 둘레의 반원 테두리
  notchRim.className = 'notch-rim';
  cdCase.append(frame, notchRim);
  caseShadow.append(cdCase);
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
  showcase.append(caseBack, turntable, caseShadow);
  const caption = makeImg(new URL('../img/caption.png', import.meta.url).href, 'caption');
  caption.alt = 'KYUDONG & SEOYOON, 2026. 10. 31 | 2:00 PM';
  composition.append(showcase, caption);
  stage.after(composition);

  const DISC = 0.84; // CD 지름 / 케이스 앞면 한 변
  const DISC_OUT = 0.7; // CD 지름 중 케이스 오른쪽 밖으로 나오는 비율
  const BACK_OUT = 0.1; // 뒷면이 앞면보다 오른쪽으로 더 나오는 길이 / 앞면 한 변
  // CD를 케이스 안(앞면 가운데)으로 넣을 때의 이동량. CD 지름 기준 %라 화면 크기가 바뀌어도 맞는다.
  const DISC_IN = `translateX(${(-(0.5 / DISC + DISC_OUT - 0.5) * 100).toFixed(2)}%)`;
  function sizePoster() {
    const room = { w: showcase.clientWidth, h: showcase.clientHeight };
    if (!room.w || !room.h) return;
    // 앞면은 1:1. 사진은 좌우 끝까지 채우고 위아래에만 여백을 둔다.
    // [케이스 + 나온 CD]를 가운데 두어, 케이스 왼쪽 간격과 나온 CD 오른쪽 간격을 같게 한다.
    const out = Math.max(DISC * DISC_OUT, BACK_OUT); // 앞면 오른쪽으로 가장 멀리 나오는 길이 / 앞면 한 변
    const size = Math.min(room.h, room.w / (1 + out));
    const d = DISC * size;
    const left = (room.w - size * (1 + out)) / 2;
    const top = (room.h - size) / 2;
    const notch = 0.075 * size;
    const rim = Math.max(4, 0.022 * size);
    Object.assign(caseShadow.style, { width: `${size}px`, height: `${size}px`, left: `${left}px`, top: `${top}px` });
    Object.assign(caseBack.style, { width: `${size * (1 + BACK_OUT)}px`, height: `${size}px`, left: `${left}px`, top: `${top}px` });
    cdCase.style.setProperty('--margin', `${0.1 * size}px`);
    cdCase.style.clipPath = `path('${casePath(size, notch)}')`;
    const ring = notch + rim; // 노치보다 rim만큼 큰 원을 오른쪽 가장자리 가운데에 두면, 잘린 노치 둘레만 반원 띠로 남는다
    Object.assign(notchRim.style, { width: `${ring * 2}px`, height: `${ring * 2}px`, left: `${size - ring}px`, top: `${size / 2 - ring}px` });
    Object.assign(turntable.style, { width: `${d}px`, left: `${left + size + d * DISC_OUT - d}px`, top: `${top + (size - d) / 2}px` });
  }

  /** 케이스 앞면 윤곽: 모서리가 직각인 정사각형에, CD가 나오는 오른쪽 입구 가운데를 반지름 r의 반원으로 파낸다. */
  function casePath(size, r) {
    const mid = size / 2;
    const f = (n) => n.toFixed(2);
    return [
      'M0,0', `L${f(size)},0`,
      `L${f(size)},${f(mid - r)}`, `A${f(r)},${f(r)} 0 0 0 ${f(size)},${f(mid + r)}`,
      `L${f(size)},${f(size)}`, `L0,${f(size)}`, 'Z',
    ].join(' ');
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

  // ---- 배경음악 ----
  // 브라우저 자동재생 정책상 사용자 입력(클릭/F 키) 전에는 소리가 나지 않을 수 있다.
  let audioEl = null;
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

  // CD 회전: 무한 회전 애니메이션의 속도를 서서히 바꿔 부드럽게 멈추고 돈다(동작 줄이기 설정이면 돌지 않음).
  const spin = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? null
    : record.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: SPIN_MS, iterations: Infinity });
  spin?.pause();
  let spinToken = 0;
  function spinTo(target, ms) {
    if (!spin) return Promise.resolve();
    const token = ++spinToken;
    const from = spin.playState === 'running' ? spin.playbackRate : 0;
    if (target > 0 && spin.playState !== 'running') {
      spin.playbackRate = 0.001;
      spin.play();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        if (token !== spinToken) return resolve();
        const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
        const rate = from + (target - from) * k * k * (3 - 2 * k);
        if (k === 1 && target === 0) spin.pause();
        else spin.playbackRate = Math.max(rate, 0.001);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** CD를 케이스 안으로 넣거나(true) 밖으로 꺼낸다(false). */
  function slideDisc(inside) {
    const frames = inside ? [{ transform: 'none' }, { transform: DISC_IN }] : [{ transform: DISC_IN }, { transform: 'none' }];
    turntable.getAnimations().forEach((anim) => anim.cancel()); // 이전 이동은 끝난 상태(fill)이므로 지워도 이어진다
    return turntable.animate(frames, { duration: SLIDE_MS, easing: 'cubic-bezier(0.55, 0, 0.25, 1)', fill: 'forwards' }).finished.catch(() => {});
  }

  function attemptPlay() {
    if (changing) return; // CD 교체 중에는 새 CD가 나온 뒤에 재생한다
    audioEl?.play().catch(() => {
      /* 자동재생 차단: 클릭이나 F 키를 받으면 다시 시도한다 */
    });
  }

  // ---- 재생 목록: 곡이 끝나면 CD 교체 연출을 거쳐 다음 곡(마지막 다음은 처음)을 재생한다 ----
  let tracks = [];
  let tracksKey = null;
  let trackIndex = 0;
  let audioTrackKey = null; // 지금 audioEl에 걸린 곡(url:version)
  let changing = false; // CD 교체 연출 중
  let trackSequence = 0; // 목록이 바뀌면 진행 중인 연출을 무효로 한다
  const trackKeyOf = (track) => `${track.url}:${track.version || ''}`;

  async function makeAudio(track) {
    let src = track.url;
    if (track.viaFetch) {
      try {
        const res = await fetch(track.url, { mode: 'cors' });
        if (!res.ok) return null;
        src = URL.createObjectURL(await res.blob());
      } catch {
        return null; // 못 불러오면 조용히 포기(음악 없이 재생은 계속된다)
      }
    }
    const el = document.createElement('audio');
    el.muted = muted;
    el.src = src;
    el.style.display = 'none';
    el.addEventListener('playing', () => el === audioEl && !changing && spinTo(1, SPIN_UP_MS));
    el.addEventListener('pause', () => el === audioEl && !el.ended && spinTo(0, STOP_MS));
    el.addEventListener('ended', () => el === audioEl && nextTrack());
    document.body.append(el);
    return el;
  }

  function useAudio(el, track) {
    if (el !== audioEl) dropAudio();
    audioEl = el;
    audioTrackKey = el ? trackKeyOf(track) : null;
    updateMuteBtn();
    updateHint();
    // 미리보기 iframe은 소리를 내지 않으므로, 음악이 등록돼 있으면 돌고 있는 모습으로 보여 준다.
    if (embedded && el) spinTo(1, 0);
  }

  function dropAudio() {
    if (!audioEl) return;
    audioEl.pause();
    if (audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
    audioEl.remove();
    audioEl = null;
    audioTrackKey = null;
  }

  async function nextTrack() {
    if (changing || !tracks.length) return;
    changing = true;
    const token = ++trackSequence;
    await spinTo(0, STOP_MS);
    await slideDisc(true);
    if (token !== trackSequence) return;
    trackIndex = (trackIndex + 1) % tracks.length;
    const track = tracks[trackIndex];
    syncCover(track.cover || null); // CD가 케이스 안에 있는 동안 인쇄면을 다음 곡 이미지로 바꾼다
    const same = trackKeyOf(track) === audioTrackKey;
    const [el] = await Promise.all([same ? audioEl : makeAudio(track), sleep(PAUSE_MS)]);
    if (token !== trackSequence) {
      if (el && el !== audioEl) el.remove();
      return;
    }
    if (same && el) el.currentTime = 0;
    useAudio(el, track);
    await slideDisc(false);
    if (token !== trackSequence) return;
    changing = false;
    attemptPlay();
  }

  /** 재생 목록을 소스에 맞춘다. 지금 곡이 목록에 남아 있으면 그대로 이어 간다. */
  async function syncTracks(list) {
    const key = list.map((t) => `${trackKeyOf(t)}:${t.cover?.url || ''}`).join('|');
    if (key === tracksKey) return;
    tracksKey = key;
    tracks = list;
    const at = audioTrackKey ? tracks.findIndex((t) => trackKeyOf(t) === audioTrackKey) : -1;
    if (at >= 0) {
      trackIndex = at;
      if (!changing) syncCover(tracks[at].cover || null);
      return;
    }
    // 처음이거나 지금 곡이 빠졌다: 연출 없이 첫 곡을 바로 건다.
    const token = ++trackSequence;
    changing = false;
    dropAudio();
    turntable.getAnimations().forEach((a) => a.cancel());
    spinTo(0, 0);
    trackIndex = 0;
    syncCover(tracks[0]?.cover || null);
    const el = tracks.length ? await makeAudio(tracks[0]) : null;
    if (token !== trackSequence) return el?.remove();
    useAudio(el, tracks[0]);
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
      // audio는 곡 하나(서버 모드) 또는 곡 목록(드라이브 모드)이다.
      syncTracks([].concat(result.audio || []));
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
    // 사진은 케이스의 정사각형 창을 꽉 채운다(넘치는 가장자리는 잘림). 잘리는 기준점은 photo.anchor.
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
    const fg = makeImg(photo.url, 'fg');
    fg.style.objectPosition = anchorPosition(photo.anchor); // 잘릴 때 남길 쪽(파일명의 top·left 등)
    photoSlide.append(fg);

    const previous = [...frame.children];
    frame.append(photoSlide);

    const t = transitionFor(effect);
    photoSlide.animate(t.enter, {
      duration: TRANS_MS * (1 - t.enterDelayRatio),
      delay: TRANS_MS * t.enterDelayRatio,
      easing: 'ease-in-out',
      fill: 'both',
    });
    // 페이드 계열 전환에서 이전 사진이 겹쳐 남지 않도록 항상 함께 사라지게 한다.
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
