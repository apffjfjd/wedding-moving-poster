import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_IDS, resolveEffect, layoutFor, motionFor, transitionFor, orientationOf } from '../public/js/effects.js';

test('BD-0003에 명시된 효과가 모두 제공된다 (FR-002)', () => {
  for (const id of ['fade', 'crossdissolve', 'zoomin', 'zoomout', 'pan', 'kenburns', 'blur', 'parallax', 'auto']) {
    assert.ok(EFFECT_IDS.includes(id), id);
  }
});

test('지정된 효과는 그대로 사용하고, 알 수 없는 값은 자동으로 취급한다', () => {
  assert.equal(resolveEffect({ effect: 'zoomin' }, 3), 'zoomin');
  assert.ok(EFFECT_IDS.includes(resolveEffect({ effect: 'nope' }, 0)));
  assert.notEqual(resolveEffect({ effect: 'nope' }, 0), 'auto');
  assert.notEqual(resolveEffect({}, 0), 'auto');
});

test('자동 효과는 사진마다 번갈아 적용되어 단조롭지 않다', () => {
  const used = new Set(Array.from({ length: 8 }, (_, i) => resolveEffect({ effect: 'auto', width: 1600, height: 900 }, i)));
  assert.ok(used.size >= 6);
});

test('세로 사진에는 자동으로 좌우 팬 이동을 쓰지 않는다', () => {
  for (let i = 0; i < 16; i++) {
    assert.notEqual(resolveEffect({ effect: 'auto', width: 900, height: 1600 }, i), 'pan');
  }
  assert.equal(resolveEffect({ effect: 'pan', width: 900, height: 1600 }, 0), 'pan'); // 사용자 지정은 존중
});

test('저사양 모드에서는 blur/parallax가 가벼운 효과로 대체된다', () => {
  assert.equal(resolveEffect({ effect: 'blur' }, 0, { lite: true }), 'crossdissolve');
  assert.equal(resolveEffect({ effect: 'parallax' }, 0, { lite: true }), 'pan');
  assert.equal(resolveEffect({ effect: 'blur' }, 0), 'blur');
});

test('FR-003: 가로/세로 판별과 레이아웃 결정', () => {
  assert.equal(orientationOf(1600, 900), 'landscape');
  assert.equal(orientationOf(900, 1600), 'portrait');
  // 16:9 화면
  assert.equal(layoutFor(1920, 1080, 1920, 1080), 'cover'); // 동일 비율
  assert.equal(layoutFor(1600, 1000, 1920, 1080), 'cover'); // 근접 비율
  assert.equal(layoutFor(900, 1600, 1920, 1080), 'blur-contain'); // 세로 사진
  assert.equal(layoutFor(1000, 1000, 1920, 1080), 'blur-contain'); // 정방형
  assert.equal(layoutFor(1920, 1080, 1080, 1920), 'blur-contain'); // 세로 화면에 가로 사진
  assert.equal(layoutFor(0, 0, 1920, 1080), 'blur-contain'); // 크기 정보 없음: 안전하게 전체 표시
});

test('모든 효과가 유효한 keyframes와 전환 정의를 반환한다', () => {
  for (const id of EFFECT_IDS.filter((e) => e !== 'auto')) {
    const m = motionFor(id);
    const targets = [m.mv, m.fg, m.bg].filter(Boolean);
    assert.ok(targets.length > 0, `${id}: 모션 없음`);
    for (const frames of targets) assert.ok(frames.length >= 2 && frames.every((f) => typeof f.transform === 'string'));
    const t = transitionFor(id);
    assert.ok(t.enter.length >= 2);
    assert.ok(t.enterDelayRatio >= 0 && t.enterDelayRatio < 1);
  }
});

test('flip 옵션은 팬 이동 방향을 뒤집는다', () => {
  assert.notDeepEqual(motionFor('pan', false).mv, motionFor('pan', true).mv);
});

test('fade는 이전 화면이 먼저 사라진 뒤 나타난다', () => {
  const t = transitionFor('fade');
  assert.equal(t.fadeOutPrev, true);
  assert.ok(t.enterDelayRatio > 0);
  assert.equal(transitionFor('crossdissolve').fadeOutPrev, false);
});
