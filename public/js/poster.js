// 사진 프레임의 가로:세로 비율. 잘못된 URL 값은 기본 4:6으로 복구한다.
export function frameRatio(width, height) {
  const w = Number(width), h = Number(height);
  return [w, h].every((n) => Number.isFinite(n) && n >= 1 && n <= 20)
    ? { width: w, height: h } : { width: 4, height: 6 };
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * 중세풍 액자 윤곽(SVG path). 위는 끝이 살짝 뾰족한 아치, 아치 시작점 아래 양옆에 작은 홈,
 * 아래 두 모서리는 안쪽으로 둥글게 파낸 형태다. inset만큼 안쪽으로 들어간 윤곽을 돌려주며,
 * 홈과 모서리는 상자 가장자리에 중심을 둔 원호라 inset을 바꿔도 서로 나란한 선이 된다.
 */
export function framePath(width, height, inset = 0) {
  const W = width, H = height, i = inset;
  const u = Math.min(W, H);
  const notch = 0.08 * u + i; // 아래 모서리 홈 반지름
  const cusp = 0.03 * u + i; // 어깨 홈 반지름
  const spring = Math.min(0.42 * W, 0.3 * H); // 아치가 시작되는 높이
  const cuspY = spring + 0.07 * u;
  const e = Math.sqrt(notch * notch - i * i);
  const q = Math.sqrt(cusp * cusp - i * i);
  const rise = spring - i;
  const half = W / 2 - i;
  return [
    `M${r2(e)},${r2(H - i)}`,
    `L${r2(W - e)},${r2(H - i)}`,
    `A${r2(notch)},${r2(notch)} 0 0 1 ${r2(W - i)},${r2(H - e)}`,
    `L${r2(W - i)},${r2(cuspY + q)}`,
    `A${r2(cusp)},${r2(cusp)} 0 0 1 ${r2(W - i)},${r2(cuspY - q)}`,
    `L${r2(W - i)},${r2(spring)}`,
    `C${r2(W - i)},${r2(spring - rise * 0.55)} ${r2(W / 2 + half * 0.42)},${r2(i + rise * 0.1)} ${r2(W / 2)},${r2(i)}`,
    `C${r2(W / 2 - half * 0.42)},${r2(i + rise * 0.1)} ${r2(i)},${r2(spring - rise * 0.55)} ${r2(i)},${r2(spring)}`,
    `L${r2(i)},${r2(cuspY - q)}`,
    `A${r2(cusp)},${r2(cusp)} 0 0 1 ${r2(i)},${r2(cuspY + q)}`,
    `L${r2(i)},${r2(H - e)}`,
    `A${r2(notch)},${r2(notch)} 0 0 1 ${r2(e)},${r2(H - i)}`,
    'Z',
  ].join(' ');
}
