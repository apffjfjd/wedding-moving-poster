import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio } from '../public/js/poster.js';

test('사진 프레임: 기본 4:6, 사용자 비율, 잘못된 URL 값 복구', () => {
  assert.deepEqual(frameRatio(null, null), { width: 4, height: 6 });
  assert.deepEqual(frameRatio('16', '9'), { width: 16, height: 9 });
  assert.deepEqual(frameRatio('4.5', '6'), { width: 4.5, height: 6 });
  for (const value of ['0', '-1', 'Infinity', 'NaN', '21', '']) {
    assert.deepEqual(frameRatio(value, '6'), { width: 4, height: 6 });
    assert.deepEqual(frameRatio('4', value), { width: 4, height: 6 });
  }
});
