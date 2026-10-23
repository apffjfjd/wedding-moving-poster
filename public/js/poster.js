// 흰 사진 프레임의 가로:세로 비율. 잘못된 URL 값은 기본 4:6으로 복구한다.
export function frameRatio(width, height) {
  const w = Number(width), h = Number(height);
  return [w, h].every((n) => Number.isFinite(n) && n >= 1 && n <= 20)
    ? { width: w, height: h } : { width: 4, height: 6 };
}
