import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdMsFromSeconds } from '../public/js/timing.js';

test('사진 표시 시간을 초에서 밀리초로 변환한다', () => {
  assert.equal(holdMsFromSeconds('8'), 8000);
  assert.equal(holdMsFromSeconds(2.5), 2500);
  assert.equal(holdMsFromSeconds(60), 60000);
});

test('표시 시간이 없거나 허용 범위를 벗어나면 기본 5초를 사용한다', () => {
  for (const value of [null, '', 'nope', 1, 61, Infinity]) {
    assert.equal(holdMsFromSeconds(value), 5000, String(value));
  }
});
