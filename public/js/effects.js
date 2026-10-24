// 전환 효과 정의 (FR-002). 브라우저(player/editor)와 Node 테스트에서 함께 쓰는 순수 모듈이다.
// 사진은 액자 안에 잘림 없이 고정되므로, 효과는 사진이 바뀔 때의 전환 방식만 고른다.

export const EFFECTS = [
  { id: 'auto', label: '자동' },
  { id: 'fade', label: '페이드' },
  { id: 'crossdissolve', label: '크로스 디졸브' },
  { id: 'blur', label: '블러 전환' },
];

// 예전에 제공하던 확대·이동 효과. 저장된 설정과 드라이브 파일명을 깨뜨리지 않도록 계속 받아들이되,
// 사진을 고정한 지금은 보여 줄 움직임이 없으므로 크로스 디졸브로 재생한다.
const LEGACY_EFFECTS = ['zoomin', 'zoomout', 'pan', 'kenburns', 'parallax'];

export const EFFECT_IDS = [...EFFECTS.map((e) => e.id), ...LEGACY_EFFECTS];

/** 편집기·재생기에서 쓸 현재 효과 id. 예전 효과는 크로스 디졸브로 바꾼다. */
export function currentEffect(id) {
  return LEGACY_EFFECTS.includes(id) ? 'crossdissolve' : id;
}

// 저사양 모드에서 filter 애니메이션을 피하기 위한 대체 효과
const LITE_FALLBACK = { blur: 'crossdissolve' };

// 자동 선택 기준(미결정 사항의 임시 규칙): 사진 순서대로 효과를 순환시켜 단조로움을 피한다.
const AUTO_CYCLE = ['crossdissolve', 'blur', 'crossdissolve', 'fade'];

export function orientationOf(width, height) {
  if (!width || !height) return 'landscape';
  return height > width ? 'portrait' : 'landscape';
}

/** 사진에 지정된 효과 또는 자동 선택된 효과를 실제 재생용 효과 id로 확정한다. */
export function resolveEffect(photo, index, { lite = false } = {}) {
  let id = photo && EFFECT_IDS.includes(photo.effect) ? currentEffect(photo.effect) : 'auto';
  if (id === 'auto') id = AUTO_CYCLE[index % AUTO_CYCLE.length];
  if (lite && LITE_FALLBACK[id]) id = LITE_FALLBACK[id];
  return id;
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
