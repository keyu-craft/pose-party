import assert from 'node:assert/strict';
import test from 'node:test';
import { isFacingScreen } from '../src/readiness.ts';
import type { FaceMatrix } from '../src/readiness.ts';
import type { Point } from '../src/poses.ts';

function sample(yaw = 0, pitch = 0, scale = 1) {
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  const face: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.3 }));
  face[33] = { x: 0.46, y: 0.28 }; face[263] = { x: 0.54, y: 0.28 };
  const body: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.3, visibility: 1 }));
  body[11] = { x: 0.4, y: 0.5, visibility: 1 }; body[12] = { x: 0.6, y: 0.5, visibility: 1 };
  // Uniformly scaled rotation. Translation must have no effect on orientation.
  const matrix: FaceMatrix = { rows: 4, columns: 4, data: [
    Math.cos(y) * scale, Math.sin(y) * Math.sin(p) * scale, Math.sin(y) * Math.cos(p) * scale, 0,
    0, Math.cos(p) * scale, -Math.sin(p) * scale, 0,
    -Math.sin(y) * scale, Math.cos(y) * Math.sin(p) * scale, Math.cos(y) * Math.cos(p) * scale, 0,
    0, 0, -50, 1,
  ] };
  return { face, body, matrix };
}
function facing(s: ReturnType<typeof sample>) { return isFacingScreen(s.face, s.matrix, s.body, 1280, 720); }

test('front-facing and modest head turns are accepted across matrix scales', () => {
  for (const scale of [0.5, 1, 2]) {
    assert.equal(facing(sample(0, 0, scale)), true);
    assert.equal(facing(sample(20, 15, scale)), true);
  }
});
test('large yaw or pitch is rejected symmetrically', () => {
  for (const angle of [-60, -40, 40, 60]) {
    assert.equal(facing(sample(angle, 0)), false);
    assert.equal(facing(sample(0, angle)), false);
  }
});
test('a missing, malformed, tiny or unrelated face cannot confirm readiness', () => {
  const s = sample();
  assert.equal(isFacingScreen([], s.matrix, s.body, 1280, 720), false);
  assert.equal(isFacingScreen(s.face, undefined, s.body, 1280, 720), false);
  const broken = sample(); broken.matrix.data[10] = NaN; assert.equal(facing(broken), false);
  const tiny = sample(); tiny.face[33].x = 0.499; tiny.face[263].x = 0.501; assert.equal(facing(tiny), false);
  const other = sample(); other.face[1].x = 0.8; assert.equal(facing(other), false);
  const hidden = sample(); hidden.body[11].visibility = 0.2; assert.equal(facing(hidden), false);
});
