// 전환·애니메이션 효과 정의 (FR-002)와 비율별 레이아웃 판정 (FR-003).
// 브라우저(player/editor)와 Node 테스트에서 함께 쓰는 순수 모듈이다.

export const EFFECTS = [
  { id: 'auto', label: '자동' },
  { id: 'fade', label: '페이드' },
  { id: 'crossdissolve', label: '크로스 디졸브' },
  { id: 'zoomin', label: '줌 인' },
  { id: 'zoomout', label: '줌 아웃' },
  { id: 'pan', label: '팬 이동' },
  { id: 'kenburns', label: 'Ken Burns' },
  { id: 'blur', label: '블러 전환' },
  { id: 'parallax', label: '패럴랙스' },
];

export const EFFECT_IDS = EFFECTS.map((e) => e.id);

// 저사양 모드에서 filter 애니메이션/이중 레이어 이동을 피하기 위한 대체 효과
const LITE_FALLBACK = { blur: 'crossdissolve', parallax: 'pan' };

// 자동 선택 기준(미결정 사항의 임시 규칙): 사진 순서대로 효과를 순환시켜 단조로움을 피한다.
const AUTO_CYCLE = ['kenburns', 'crossdissolve', 'zoomin', 'blur', 'pan', 'zoomout', 'parallax', 'fade'];

export function orientationOf(width, height) {
  if (!width || !height) return 'landscape';
  return height > width ? 'portrait' : 'landscape';
}

/** 사진에 지정된 효과 또는 자동 선택된 효과를 실제 재생용 효과 id로 확정한다. */
export function resolveEffect(photo, index, { lite = false } = {}) {
  let id = photo && EFFECT_IDS.includes(photo.effect) ? photo.effect : 'auto';
  if (id === 'auto') {
    id = AUTO_CYCLE[index % AUTO_CYCLE.length];
    // 세로 사진은 좌우 팬 이동 시 여백이 크게 드러나므로 Ken Burns로 대체한다.
    if (id === 'pan' && orientationOf(photo?.width, photo?.height) === 'portrait') id = 'kenburns';
  }
  if (lite && LITE_FALLBACK[id]) id = LITE_FALLBACK[id];
  return id;
}

/**
 * 사진과 화면 비율을 비교해 레이아웃을 정한다.
 * - cover: 화면과 비율이 비슷하면 화면을 꽉 채운다.
 * - blur-contain: 비율 차이가 크면(예: 세로 사진) 확대·블러 배경 위에 원본 전체를 배치한다.
 */
export function layoutFor(photoWidth, photoHeight, viewWidth, viewHeight) {
  if (!photoWidth || !photoHeight || !viewWidth || !viewHeight) return 'blur-contain';
  const diff = Math.abs(Math.log(photoWidth / photoHeight / (viewWidth / viewHeight)));
  return diff < 0.18 ? 'cover' : 'blur-contain';
}

const ease = 'linear';

/**
 * 슬라이드가 화면에 머무는 전체 시간(등장 전환 + 정지 + 다음 슬라이드 등장 전환) 동안의 모션.
 * 반환: { mv, fg, bg } — 각각 Web Animations API keyframes 배열 또는 null.
 *  mv: 슬라이드 전체 래퍼, fg: 원본 이미지, bg: 블러 배경 이미지
 * flip: 팬/Ken Burns 방향을 번갈아 바꿔 단조로움을 줄인다.
 */
export function motionFor(effect, flip = false) {
  const s = flip ? -1 : 1;
  switch (effect) {
    case 'zoomin':
      return { mv: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }] };
    case 'zoomout':
      return { mv: [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }] };
    case 'pan':
      return {
        mv: [
          { transform: `translate3d(${-3 * s}%,0,0) scale(1.08)` },
          { transform: `translate3d(${3 * s}%,0,0) scale(1.08)` },
        ],
      };
    case 'kenburns':
      return {
        mv: [
          { transform: `scale(1.02) translate3d(${1.5 * s}%,1.5%,0)` },
          { transform: `scale(1.16) translate3d(${-2 * s}%,-2%,0)` },
        ],
      };
    case 'parallax':
      return {
        fg: [
          { transform: `translate3d(${-2.5 * s}%,0,0) scale(1.05)` },
          { transform: `translate3d(${2.5 * s}%,0,0) scale(1.05)` },
        ],
        bg: [
          { transform: `translate3d(${4 * s}%,0,0) scale(1.25)` },
          { transform: `translate3d(${-4 * s}%,0,0) scale(1.25)` },
        ],
      };
    case 'blur':
    case 'crossdissolve':
    case 'fade':
    default:
      // 정지 화면이 굳어 보이지 않도록 미세한 줌만 준다.
      return { mv: [{ transform: 'scale(1.02)' }, { transform: 'scale(1.07)' }] };
  }
}

/**
 * 슬라이드가 나타나는 전환 애니메이션(래퍼 opacity/filter).
 * fade는 이전 화면이 먼저 사라진 뒤 나타나는 방식이라 outgoing 처리가 함께 필요하다.
 * 반환: { enter: keyframes, enterDelayRatio: 0~1(전환 시간 중 지연 비율), fadeOutPrev: boolean }
 */
export function transitionFor(effect) {
  switch (effect) {
    case 'fade':
      return { enter: [{ opacity: 0 }, { opacity: 1 }], enterDelayRatio: 0.5, fadeOutPrev: true };
    case 'blur':
      return {
        enter: [
          { opacity: 0, filter: 'blur(28px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        enterDelayRatio: 0,
        fadeOutPrev: false,
      };
    default:
      return { enter: [{ opacity: 0 }, { opacity: 1 }], enterDelayRatio: 0, fadeOutPrev: false };
  }
}

export { ease as MOTION_EASING };
