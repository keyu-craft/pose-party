import assert from 'node:assert/strict';
import test from 'node:test';
import { RoundEngine, TIMING, targetMode, formatTime } from '../src/game.ts';
import { COPY } from '../src/i18n.ts';

function launch() {
  const game = new RoundEngine();
  for (let t = 0; t <= 1000; t += 50) game.update(true, false, true, t);
  return game;
}
function completeFirst() {
  const game = launch();
  for (let t = 1050; t <= 2050; t += 50) game.update(true, true, false, t);
  return game;
}

test('body presence alone never starts the clock, and waiting does not consume the minute', () => {
  const game = new RoundEngine();
  for (let t = 0; t <= 2000; t += 50) {
    const state = game.update(true, true, false, t);
    assert.equal(state.phase, 'ready'); assert.equal(state.roundId, 0);
    assert.equal(state.readyProgress, 0); assert.equal(targetMode(state, true), 'rest');
  }
  assert.equal(game.clock(500_000).remainingMs, 60_000);
});

test('one continuous second facing the screen starts the first target and sixty-second clock together', () => {
  const game = new RoundEngine();
  for (let t = 0; t < 1000; t += 50) {
    const state = game.update(false, false, true, t);
    assert.equal(state.phase, 'ready'); assert.ok(state.readyProgress < 1);
    assert.equal(state.remainingMs, 60_000);
  }
  const state = game.update(false, false, true, 1000);
  assert.equal(state.phase, 'match'); assert.equal(state.roundId, 1);
  assert.equal(state.score, 0); assert.equal(state.progress, 0);
  assert.equal(state.remainingMs, 60_000); assert.equal(targetMode(state, true), 'pose');
  assert.equal(game.clock(2000).remainingMs, 59_000);
});

test('looking away or a stalled readiness observation resets the confirmation ring', () => {
  const game = new RoundEngine();
  for (let t = 0; t <= 500; t += 50) game.update(true, false, true, t);
  assert.equal(game.update(true, false, false, 550).readyProgress, 0);
  assert.equal(game.update(true, false, true, 600).readyProgress, 0);
  assert.equal(game.update(true, false, true, 2000).readyProgress, 0);
  for (let t = 2050; t < 3000; t += 50) assert.equal(game.update(true, false, true, t).phase, 'ready');
  assert.equal(game.update(true, false, true, 3000).phase, 'match');
});

test('active play does not need face orientation and has no per-pose deadline', () => {
  const game = launch();
  for (let t = 1050; t <= 20000; t += 50) {
    const state = game.update(true, false, false, t);
    assert.equal(state.phase, 'match'); assert.equal(state.roundId, 1);
  }
  assert.equal(game.update(true, true, false, 20050).phase, 'hold');
});

test('one second of matching scores exactly once and immediately hides the completed pose', () => {
  const game = launch();
  assert.equal(game.update(true, true, false, 1050).progress, 0);
  for (let t = 1100; t < 2050; t += 50) {
    const state = game.update(true, true, false, t);
    assert.equal(state.phase, 'hold'); assert.equal(state.score, 0);
  }
  const state = game.update(true, true, false, 2050);
  assert.equal(state.phase, 'success'); assert.equal(state.score, 1);
  assert.equal(targetMode(state, true), 'rest');
  assert.equal(game.update(true, true, false, 2100).score, 1);
});

test('losing the pose or tracking resets the hold and retains the same target', () => {
  const game = launch();
  for (let t = 1050; t <= 1500; t += 50) game.update(true, true, false, t);
  const state = game.update(true, false, false, 1550);
  assert.equal(state.phase, 'match'); assert.equal(state.progress, 0); assert.equal(state.roundId, 1);
  assert.equal(game.update(false, false, false, 1600).roundId, 1);
  assert.equal(game.update(true, true, false, 1650).progress, 0);
  assert.equal(game.update(true, true, false, 4000).progress, 0);
});

test('success and transition show a default figure, then reveal a clean next target without another readiness check', () => {
  const game = completeFirst();
  for (let t = 2100; t < 2500; t += 50) {
    const state = game.update(true, true, false, t);
    assert.equal(state.phase, 'success'); assert.equal(targetMode(state, true), 'rest');
  }
  for (let t = 2500; t < 3400; t += 50) {
    const state = game.update(true, true, false, t);
    assert.equal(state.phase, 'transition'); assert.equal(state.roundId, 1);
    assert.equal(targetMode(state, true), 'rest');
  }
  const state = game.update(true, true, false, 3400);
  assert.equal(state.phase, 'match'); assert.equal(state.roundId, 2);
  assert.equal(state.progress, 0); assert.equal(state.score, 1);
});

test('the clock expires with no video frames, during an interlude, or after a hidden tab', () => {
  for (const game of [launch(), completeFirst()]) {
    game.interrupt(3000);
    const state = game.clock(61_000);
    assert.equal(state.phase, 'finished'); assert.equal(state.remainingMs, 0);
    assert.equal(targetMode(state, true), 'rest');
    assert.equal(game.update(true, true, true, 62_000).phase, 'finished');
  }
});

test('a pose completed exactly at or after the sixty-second deadline cannot score', () => {
  for (const finishAt of [61_000, 61_050]) {
    const game = launch();
    for (let t = 1050; t < 60000; t += 50) game.update(true, false, false, t);
    for (let t = 60000; t < 61000; t += 50) game.update(true, true, false, t);
    const state = game.update(true, true, false, finishAt);
    assert.equal(state.phase, 'finished'); assert.equal(state.score, 0);
  }
});

test('a valid completion immediately before the deadline is counted and the final score freezes', () => {
  const game = launch();
  for (let t = 1050; t < 59950; t += 50) game.update(true, false, false, t);
  for (let t = 59950; t <= 60950; t += 50) game.update(true, true, false, t);
  const result = game.clock(61000);
  assert.equal(result.phase, 'finished'); assert.equal(result.score, 1);
  assert.equal(game.update(true, true, true, 62000).score, 1);
});

test('replaying requires a reset and a fresh one-second confirmation', () => {
  const game = completeFirst(); game.clock(61000);
  for (let t = 61100; t <= 62200; t += 50) assert.equal(game.update(true, true, true, t).phase, 'finished');
  const reset = game.reset();
  assert.equal(reset.phase, 'ready'); assert.equal(reset.score, 0);
  assert.equal(reset.remainingMs, TIMING.sessionMs); assert.equal(reset.roundId, 0);
  assert.equal(game.update(true, false, true, 62300).readyProgress, 0);
});

test('the displayed clock uses whole seconds without showing zero before expiry', () => {
  assert.equal(formatTime(60000), '01:00'); assert.equal(formatTime(59999), '01:00');
  assert.equal(formatTime(59000), '00:59'); assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(0), '00:00');
});

test('English and Chinese cover readiness, session results and all error messages', () => {
  assert.deepEqual(Object.keys(COPY.en).sort(), Object.keys(COPY.zh).sort());
  for (const value of [...Object.values(COPY.en), ...Object.values(COPY.zh)]) {
    assert.ok(value.length > 0); assert.ok(!value.includes('0.5'));
  }
});

test('a brief uncertain frame pauses progress without erasing it or counting missing time', () => {
  const game = launch();
  for (let t = 1050; t <= 1550; t += 50) game.update(true, true, false, t, false);
  const missing = game.update(false, false, false, 1600, false);
  assert.equal(missing.phase, 'hold'); assert.equal(missing.progress, 0.5);
  const resumed = game.update(true, true, false, 1650, false);
  assert.equal(resumed.phase, 'hold'); assert.equal(resumed.progress, 0.5);
  for (let t = 1700; t < 2150; t += 50) assert.equal(game.update(true, true, false, t, false).score, 0);
  assert.equal(game.update(true, true, false, 2150, false).score, 1);
});

test('prolonged uncertainty and a clear wrong pose still reset the hold', () => {
  const game = launch();
  for (let t = 1050; t <= 1550; t += 50) game.update(true, true, false, t, false);
  for (let t = 1600; t <= 1750; t += 50) assert.equal(game.update(false, false, false, t, false).phase, 'hold');
  assert.equal(game.update(false, false, false, 1800, false).phase, 'match');
  assert.equal(game.update(true, true, false, 1850, false).progress, 0);
  assert.equal(game.update(true, false, false, 1900, true).phase, 'match');
});

test('repeated missing samples cannot manufacture a one-second pass', () => {
  const game = launch();
  game.update(true, true, false, 1050, false);
  for (let t = 1100; t <= 5000; t += 50) {
    const valid = t % 100 === 0;
    const state = game.update(valid, valid, false, t, false);
    assert.equal(state.score, 0); assert.equal(state.progress, 0.05);
  }
});
