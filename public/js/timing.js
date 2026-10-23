export const DEFAULT_HOLD_SECONDS = 5;
export const MIN_HOLD_SECONDS = 2;
export const MAX_HOLD_SECONDS = 60;

/** URL/UI에서 받은 사진 표시 시간을 안전한 밀리초 값으로 바꾼다. */
export function holdMsFromSeconds(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_HOLD_SECONDS * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < MIN_HOLD_SECONDS || seconds > MAX_HOLD_SECONDS) {
    return DEFAULT_HOLD_SECONDS * 1000;
  }
  return Math.round(seconds * 1000);
}
