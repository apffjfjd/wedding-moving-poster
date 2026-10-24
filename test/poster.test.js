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

test('액자 윤곽: inset만큼 안쪽으로 들어간 직사각형', () => {
  assert.equal(framePath(400, 600, 10), 'M10,10 L390,10 L390,590 L10,590 Z');
  assert.equal(framePath(400, 600), 'M0,0 L400,0 L400,600 L0,600 Z');
});
