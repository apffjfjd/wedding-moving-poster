// 사진 프레임의 가로:세로 비율. 잘못된 URL 값은 기본 4:6으로 복구한다.
export function frameRatio(width, height) {
  const w = Number(width), h = Number(height);
  return [w, h].every((n) => Number.isFinite(n) && n >= 1 && n <= 20)
    ? { width: w, height: h } : { width: 4, height: 6 };
}

const r2 = (n) => Math.round(n * 100) / 100;

/** 사진 액자 윤곽(SVG path): inset만큼 안쪽으로 들어간 직사각형 */
export function framePath(width, height, inset = 0) {
  const x0 = r2(inset), y0 = r2(inset), x1 = r2(width - inset), y1 = r2(height - inset);
  return `M${x0},${y0} L${x1},${y0} L${x1},${y1} L${x0},${y1} Z`;
}
