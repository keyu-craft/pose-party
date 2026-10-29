import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsFrame, frameStage } from '../src/inference-policy.ts';
const ticket = { generation: 2, revision: 1, roundId: 4, stage: 'play' as const, capturedAt: 1000 };
const current = { generation: 2, revision: 1, roundId: 4, stage: 'play' as const, visible: true, running: true };

test('a fresh result is accepted while the same target moves from matching into holding', () => {
  assert.equal(frameStage('match'), frameStage('hold'));
  assert.equal(acceptsFrame(ticket, current, 1070), true);
});
test('results from another run, pose, preparation stage or interrupted capture are discarded', () => {
  assert.equal(acceptsFrame(ticket, { ...current, generation: 3 }, 1070), false);
  assert.equal(acceptsFrame(ticket, { ...current, roundId: 5 }, 1070), false);
  assert.equal(acceptsFrame(ticket, { ...current, revision: 2 }, 1070), false);
  assert.equal(acceptsFrame(ticket, { ...current, stage: 'ready' }, 1070), false);
});
test('late, hidden, stopped and invalid-timestamp results cannot contribute to scoring', () => {
  assert.equal(acceptsFrame(ticket, current, 1251), false);
  assert.equal(acceptsFrame(ticket, current, 999), false);
  assert.equal(acceptsFrame(ticket, current, NaN), false);
  assert.equal(acceptsFrame(ticket, { ...current, visible: false }, 1070), false);
  assert.equal(acceptsFrame(ticket, { ...current, running: false }, 1070), false);
});
