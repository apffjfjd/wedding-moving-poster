import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio, framePath } from '../public/js/poster.js';

test('사진 프레임: 기본 4:6, 사용자 비율, 잘못된 URL 값 복구', () => {
  assert.deepEqual(frameRatio(null, null), { width: 4, height: 6 });
  assert.deepEqual(frameRatio('16', '9'), { width: 16, height: 9 });
  assert.deepEqual(frameRatio('4.5', '6'), { width: 4.5, height: 6 });
  for (const value of ['0', '-1', 'Infinity', 'NaN', '21', '']) {
    assert.deepEqual(frameRatio(value, '6'), { width: 4, height: 6 });
    assert.deepEqual(frameRatio('4', value), { width: 4, height: 6 });
  }
});

test('액자 윤곽: 상자 안에 들어가는 닫힌 경로이며 극단적인 비율에서도 유효하다', () => {
  for (const [w, h] of [[400, 600], [600, 400], [1000, 50], [50, 1000]]) {
    for (const inset of [0, 8, 20]) {
      const d = framePath(w, h, inset);
      assert.match(d, /^M.*Z$/);
      assert.doesNotMatch(d, /NaN|Infinity/);
      const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
      assert.ok(nums.every((n) => n >= 0 && n <= Math.max(w, h)), `${w}x${h} inset ${inset}`);
    }
  }
});
