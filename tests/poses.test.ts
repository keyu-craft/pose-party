import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePose, POSES } from '../src/poses.ts';
import type { Pose } from '../src/poses.ts';
import { evaluatePose, PoseMatcher } from '../src/matching.ts';
import { observation } from './observations.ts';

const headPose = POSES.find(p => p.id === 'shrug-right')!;
const evaluate = (actual: Pose, target = actual, width = 960, height = 720, scale = 1, offset = 0, bodyRoll = 0) => {
  const o = observation(actual, width, height, scale, offset, bodyRoll);
  return evaluatePose(o.body, target, width, height, o.face);
};

test('all 20 ideal poses pass, including six distinct head-and-arm combinations', () => {
  assert.equal(POSES.length, 20); assert.equal(POSES.filter(p => p.headTilt !== undefined).length, 6);
  for (const actual of POSES) {
    for (const target of POSES) {
      const result = evaluate(actual, target);
      assert.equal(result.valid, true);
      assert.equal(result.matches, actual.id === target.id, `${actual.id} vs ${target.id}`);
    }
  }
});

test('matching is invariant to aspect ratio, position, body size and modest whole-body roll', () => {
  for (const [w, h] of [[960, 720], [1280, 720], [720, 960]]) {
    for (const pose of POSES) {
      for (const roll of [-20, 0, 20]) assert.equal(evaluate(pose, pose, w, h, 0.75, -0.05, roll).matches, true, `${pose.id}, roll ${roll}`);
    }
  }
});

test('whole-body roll alone cannot substitute for the required relative head tilt', () => {
  assert.equal(evaluate({ ...headPose, headTilt: 0 }, headPose, 960, 720, 1, 0, 24).matches, false);
  assert.equal(evaluate({ ...headPose, headTilt: -24 }, headPose).matches, false);
});

test('head targets require current visible face landmarks; original arm-only targets do not', () => {
  const head = observation(headPose);
  assert.equal(evaluatePose(head.body, headPose, 960, 720).valid, false);
  const basic = observation(POSES[0]);
  assert.equal(evaluatePose(basic.body, POSES[0], 960, 720).matches, true);
});

test('missing, occluded, out-of-frame, and collapsed joints cannot pass', () => {
  assert.equal(evaluatePose([], POSES[0], 960, 720).valid, false);
  for (const patch of [{ visibility: 0.3 }, { x: -0.1 }, { x: NaN }]) {
    const { body } = observation(POSES[0]); Object.assign(body[15], patch);
    assert.equal(evaluatePose(body, POSES[0], 960, 720).valid, false);
  }
  const { body } = observation(POSES[0]); body[15] = { ...body[13] };
  assert.equal(evaluatePose(body, POSES[0], 960, 720).matches, false);
});

test('random selection never repeats the previous pose', () => {
  for (const pose of POSES) {
    for (const random of [0, 0.2, 0.5, 0.99]) assert.notEqual(choosePose(pose.id, () => random).id, pose.id);
  }
});

test('angle jitter near the initial boundary does not repeatedly break an acquired match', () => {
  const matcher = new PoseMatcher(), target = POSES[0];
  const initial = observation(target);
  assert.equal(matcher.update(initial.body, [], target, 960, 720, 0).matches, true);
  for (let i = 1; i <= 20; i++) {
    const delta = i % 2 ? 27 : 32;
    const noisy = observation({ ...target, angles: target.angles.map(a => a + delta) as unknown as Pose['angles'] });
    assert.equal(matcher.update(noisy.body, [], target, 960, 720, i * 50).matches, true);
  }
});

test('smoothing never hides a large wrong movement or the wrong head direction', () => {
  const matcher = new PoseMatcher();
  const right = observation(headPose);
  assert.equal(matcher.update(right.body, right.face, headPose, 960, 720, 0).matches, true);
  const wrong = observation({ ...headPose, headTilt: -24 });
  const result = matcher.update(wrong.body, wrong.face, headPose, 960, 720, 50);
  assert.equal(result.matches, false); assert.equal(result.decisiveMismatch, true);
  const armMatcher = new PoseMatcher(), t = observation(POSES[0]);
  armMatcher.update(t.body, [], POSES[0], 960, 720, 0);
  const arms = observation({ ...POSES[0], angles: [100, 100, 80, 80] });
  assert.equal(armMatcher.update(arms.body, [], POSES[0], 960, 720, 50).decisiveMismatch, true);
});

test('missing face data cannot reuse a prior good head tilt, and a new target clears the filter', () => {
  const matcher = new PoseMatcher(), o = observation(headPose);
  matcher.update(o.body, o.face, headPose, 960, 720, 0);
  assert.equal(matcher.update(o.body, [], headPose, 960, 720, 50).valid, false);
  const opposite = POSES.find(p => p.id === 'shrug-left')!;
  assert.equal(matcher.update(o.body, o.face, opposite, 960, 720, 100).matches, false);
  matcher.reset();
  const newPose = observation(opposite);
  assert.equal(matcher.update(newPose.body, newPose.face, opposite, 960, 720, 150).matches, true);
});

test('a long visibility loss requires a new strict match instead of retaining the loose hold threshold', () => {
  const matcher = new PoseMatcher(), pose = POSES[0], good = observation(pose);
  matcher.update(good.body, [], pose, 960, 720, 0);
  matcher.update([], [], pose, 960, 720, 50);
  matcher.update([], [], pose, 960, 720, 150);
  const borderline = observation({ ...pose, angles: [212, 212, 32, 32] });
  assert.equal(matcher.update(borderline.body, [], pose, 960, 720, 250).matches, false);
});

test('failure reasons distinguish out-of-frame wrists, visibility, head direction and missing face data', () => {
  const o = observation(POSES[0]); o.body[15].y = 1.1;
  assert.ok(evaluatePose(o.body, POSES[0], 960, 720).reasons.includes('left-wrist-out-of-frame'));
  const weak = observation(POSES[0]); weak.body[16].visibility = 0.1;
  assert.ok(evaluatePose(weak.body, POSES[0], 960, 720).reasons.includes('right-wrist-low-confidence'));
  const head = observation(headPose);
  assert.ok(evaluatePose(head.body, headPose, 960, 720).reasons.includes('face-missing'));
  const wrong = observation({ ...headPose, headTilt: -24 });
  assert.ok(evaluatePose(wrong.body, headPose, 960, 720, wrong.face).reasons.includes('head-angle'));
  const matcher = new PoseMatcher();
  assert.ok(matcher.update(head.body, [], headPose, 960, 720, 0, 'face-not-frontal').reasons.includes('face-not-frontal'));
});
