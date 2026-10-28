import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, EFFECT_IDS, currentEffect, resolveEffect, transitionFor, orientationOf, anchorPosition } from '../public/js/effects.js';

test('선택할 수 있는 효과는 자동과 세 가지 전환이다 (FR-002)', () => {
  assert.deepEqual(EFFECTS.map((e) => e.id), ['auto', 'fade', 'crossdissolve', 'blur']);
});

test('예전 확대·이동 효과도 저장 값으로는 받아들이고 크로스 디졸브로 재생한다', () => {
  for (const id of ['zoomin', 'zoomout', 'pan', 'kenburns', 'parallax']) {
    assert.ok(EFFECT_IDS.includes(id), id);
    assert.equal(currentEffect(id), 'crossdissolve');
    assert.equal(resolveEffect({ effect: id }, 0), 'crossdissolve');
  }
  assert.equal(currentEffect('fade'), 'fade');
});

test('지정된 효과는 그대로 사용하고, 알 수 없는 값은 자동으로 취급한다', () => {
  assert.equal(resolveEffect({ effect: 'fade' }, 3), 'fade');
  assert.ok(EFFECT_IDS.includes(resolveEffect({ effect: 'nope' }, 0)));
  assert.notEqual(resolveEffect({ effect: 'nope' }, 0), 'auto');
  assert.notEqual(resolveEffect({}, 0), 'auto');
});

test('자동 효과는 사진마다 번갈아 적용되어 단조롭지 않다', () => {
  const used = new Set(Array.from({ length: 8 }, (_, i) => resolveEffect({ effect: 'auto' }, i)));
  assert.deepEqual([...used].sort(), ['blur', 'crossdissolve', 'fade']);
});

test('저사양 모드에서는 blur가 가벼운 효과로 대체된다', () => {
  assert.equal(resolveEffect({ effect: 'blur' }, 0, { lite: true }), 'crossdissolve');
  assert.equal(resolveEffect({ effect: 'blur' }, 0), 'blur');
});

test('FR-003: 가로/세로 판별', () => {
  assert.equal(orientationOf(1600, 900), 'landscape');
  assert.equal(orientationOf(900, 1600), 'portrait');
  assert.equal(orientationOf(0, 0), 'landscape');
});

test('모든 효과가 유효한 전환 정의를 반환한다', () => {
  for (const id of EFFECT_IDS.filter((e) => e !== 'auto')) {
    const t = transitionFor(currentEffect(id));
    assert.ok(t.enter.length >= 2);
    assert.ok(t.enterDelayRatio >= 0 && t.enterDelayRatio < 1);
  }
});

test('fade는 이전 화면이 먼저 사라진 뒤 나타난다', () => {
  const t = transitionFor('fade');
  assert.equal(t.fadeOutPrev, true);
  assert.ok(t.enterDelayRatio > 0);
  assert.equal(transitionFor('crossdissolve').fadeOutPrev, false);
});

test('anchorPosition: 기준점을 object-position으로 바꾸고, 없거나 모르는 값은 가운데', () => {
  assert.equal(anchorPosition('topleft'), '0% 0%');
  assert.equal(anchorPosition('bottom'), '50% 100%');
  assert.equal(anchorPosition('right'), '100% 50%');
  assert.equal(anchorPosition(undefined), '50% 50%');
  assert.equal(anchorPosition('toString'), '50% 50%');
});
