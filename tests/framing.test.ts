import assert from 'node:assert/strict';
import test from 'node:test';
import { framingIssue } from '../src/framing.ts';
import { evaluatePose, PoseMatcher } from '../src/matching.ts';
import { RoundEngine } from '../src/game.ts';
import { POSES } from '../src/poses.ts';
import { uncertaintyGrace, outsideEdges } from '../src/tracking-policy.ts';
import { observation } from './observations.ts';

test('a centered upper body leaves space for all targets at common camera aspect ratios', () => {
  for (const [width,height] of [[1280,720], [960,720], [720,960]]) for (const pose of POSES) {
    const o = observation(pose,width,height);
    assert.equal(framingIssue(o.body,width,height), null, `${width}×${height}, ${pose.id}`);
  }
});
test('preparation requests distance or centering even when current hands are missing', () => {
  const close = observation(POSES[0],1280,720,1.5); close.body[15].visibility = 0;
  assert.equal(framingIssue(close.body,1280,720), 'framing-step-back');
  const offset = observation(POSES[0],1280,720,1,.4);
  assert.equal(framingIssue(offset.body,1280,720), 'framing-center');
  assert.equal(framingIssue([],1280,720), 'framing-shoulders');
  assert.equal(framingIssue(close.body,NaN,720), 'framing-shoulders');
});
test('facing the screen at an unsuitable standing position does not start the minute', () => {
  const game = new RoundEngine();
  const close = observation(POSES[0],1280,720,1.5), good = observation(POSES[0],1280,720);
  for (let now=0; now<=1500; now+=50) assert.equal(game.update(true,true,framingIssue(close.body,1280,720) === null,now).phase,'ready');
  assert.equal(game.clock(1500).remainingMs,60000);
  for (let now=1550;now<2550;now+=50) assert.equal(game.update(true,true,framingIssue(good.body,1280,720) === null,now).phase,'ready');
  assert.equal(game.update(true,true,true,2550).phase,'match');
});
test('confident joints in the image edge strip are usable, actual offscreen joints are invalid with mirrored edge codes', () => {
  for (const x of [.001,.999]) {
    const o = observation(POSES[0]); o.body[15].x = x;
    assert.equal(evaluatePose(o.body,POSES[0],960,720).valid,true);
  }
  const o = observation(POSES[0]); o.body[15].x = -0.001;
  const result = evaluatePose(o.body,POSES[0],960,720);
  assert.equal(result.valid,false); assert.ok(result.reasons.includes('left-wrist-out-of-frame')); assert.ok(result.reasons.includes('frame-right'));
  assert.deepEqual(outsideEdges({x:1.1,y:-.1}),['frame-left','frame-top']);
});
test('only isolated boundary loss gets extra grace; confidence, face and stale-frame failures do not', () => {
  assert.equal(uncertaintyGrace(['left-wrist-out-of-frame','frame-bottom']),300);
  for (const reasons of [[],['left-wrist-low-confidence'],['left-wrist-out-of-frame','face-missing'],['stale-frame']]) assert.equal(uncertaintyGrace(reasons),150);
});
function holding() {
  const game = new RoundEngine(); for(let now=0;now<=1000;now+=50) game.update(true,true,true,now);
  for(let now=1050;now<=1550;now+=50) game.update(true,true,false,now);
  return game;
}
test('a 250ms edge interruption preserves progress but earns no hold time and still needs a full visible second', () => {
  const game = holding();
  for(let now=1600;now<=1850;now+=50) {
    const state = game.update(false,false,false,now,false,300); assert.equal(state.phase,'hold'); assert.equal(state.progress,.5); assert.equal(state.score,0);
  }
  assert.equal(game.update(true,true,false,1900).progress,.5);
  for(let now=1950;now<2400;now+=50) assert.equal(game.update(true,true,false,now).score,0);
  assert.equal(game.update(true,true,false,2400).score,1);
});
test('long loss, mixed failures and a clear wrong pose reset progress; edge observations can never finish a round', () => {
  const game = holding(); for(let now=1600;now<=1950;now+=50) game.update(false,false,false,now,false,300);
  assert.equal(game.update(true,true,false,2000).progress,0);
  const mixed = holding(); mixed.update(false,false,false,1600,false,300);
  assert.equal(mixed.update(false,false,false,1800,false,150).phase,'match');
  const wrong = holding(); assert.equal(wrong.update(false,false,false,1600,true,300).phase,'match');
  const repeated = holding(); for(let now=1600;now<=5000;now+=50) assert.equal(repeated.update(false,false,false,now,false,300).score,0);
});
test('matcher retains its acquired tolerance for short edge loss without reusing a missing wrist', () => {
  const matcher = new PoseMatcher(), pose = POSES[0], good = observation(pose);
  assert.equal(matcher.update(good.body,[],pose,960,720,0).matches,true);
  const lost = observation(pose); lost.body[15].y = 1.1;
  for(let now=50;now<=250;now+=50) assert.equal(matcher.update(lost.body,[],pose,960,720,now).valid,false);
  const jitter = observation({...pose,angles:[150,150,30,30]});
  assert.equal(matcher.update(jitter.body,[],pose,960,720,300).matches,true);
});
