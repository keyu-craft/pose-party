import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAGNOSTIC_LIMITS, PerformanceRecorder, summarize } from '../src/diagnostics.ts';
import type { ProfileContext } from '../src/diagnostics.ts';

const context = (mode: ProfileContext['mode'], poseId = 't'): ProfileContext => ({ mode, phase: 'match', poseId, roundId: 1 });
function recorder(video = true) { return new PerformanceRecorder('run-1', '2026-10-29T00:00:00.000Z', 0, { test: true }, { longTasks: true, videoFrameCallbacks: video }); }
const sample = (faceMs: number | null = null) => ({ poseMs: 10, faceMs, matchingMs: 1, drawingMs: 2, totalMs: 13 + (faceMs ?? 0), valid: true, matched: false });

test('body-only and dual-model samples are compared separately, with absent face calls kept absent', () => {
  const r = recorder();
  r.setContext(context('arms'), 0);
  r.inference(sample(), 100); r.inference(sample(), 200);
  r.setContext(context('head', 'shrug-left'), 1000);
  r.inference(sample(25), 1100); r.inference(sample(35), 1200);
  r.finish('finished', 2000);
  const report = r.snapshot(3000);
  assert.equal(report.groups.arms.visibleMs, 1000);
  assert.equal(report.groups.head.visibleMs, 1000);
  assert.equal(report.groups.arms.poseMs.mean, 10);
  assert.equal(report.groups.arms.faceMs.count, 0);
  assert.equal(report.groups.head.faceMs.mean, 30);
  assert.equal(report.groups.head.faceMs.p95, 35);
  assert.equal(report.groups.head.checksPerSecond, 2);
  assert.equal(report.samples[2].poseId, 'shrug-left');
});

test('display, camera and inference rates use independent counters', () => {
  const r = recorder(); r.setContext(context('arms'), 0);
  for (let i = 0; i < 60; i++) r.frame(i * 1000 / 60);
  r.videoFrames(30);
  for (let i = 0; i < 20; i++) r.inference(sample(), i * 50);
  r.finish('finished', 1000);
  const g = r.snapshot(1000).groups.arms;
  assert.equal(g.displayFps, 60); assert.equal(g.cameraFps, 30); assert.equal(g.checksPerSecond, 20);
});

test('hidden time is excluded and returning to the page does not create a false giant stall', () => {
  const r = recorder(); r.setContext(context('head'), 0);
  r.frame(0); r.frame(50); r.visibility(false, 100);
  r.frame(5000); r.videoFrames(100); r.visibility(true, 10100);
  r.frame(10100); r.frame(10150); r.finish('stopped', 10200);
  const report = r.snapshot(10200);
  assert.equal(report.groups.head.visibleMs, 200);
  assert.equal(report.groups.head.frames, 4);
  assert.equal(report.groups.head.slowFrames, 0);
  assert.equal(report.groups.head.cameraFrames, 0);
});

test('visible stalls carry their pose, timestamp and phase into the export and per-second timeline', () => {
  const r = recorder(); r.setContext(context('head', 'robot-left'), 0);
  r.frame(0); r.frame(150);
  const report = r.snapshot(200);
  const stall = report.events.find(e => e.type === 'frame-gap')!;
  assert.equal(stall.atMs, 150); assert.equal(stall.durationMs, 150);
  assert.equal(stall.poseId, 'robot-left'); assert.equal(stall.mode, 'head');
  assert.equal(report.groups.head.slowFrames, 1);
  assert.equal(report.timeline[0].slowFrames, 1);
});

test('long tasks are attributed by when they started, not by the later observer delivery time', () => {
  const r = recorder(); r.setContext(context('arms'), 0);
  r.setContext(context('head'), 100); r.longTask(50, 80);
  r.visibility(false, 200); r.longTask(250, 90);
  const report = r.snapshot(400);
  assert.equal(report.groups.arms.longTasks, 1); assert.equal(report.groups.arms.longTaskMs, 80);
  assert.equal(report.groups.head.longTasks, 0);
});

test('GPU fallback, startup stages, camera format and outcome survive a JSON round trip', () => {
  const r = recorder();
  r.stage('face-gpu', 0, 100, false); r.event('delegate-fallback', 100, undefined, 'face-gpu-to-cpu');
  r.stage('face-cpu', 100, 150, true); r.delegate('face', 'CPU'); r.delegate('pose', 'GPU');
  r.setCamera(1280, 720, 30); r.finish('cancelled', 200);
  const report = JSON.parse(JSON.stringify(r.snapshot(500)));
  assert.equal(report.elapsedMs, 200); assert.equal(report.outcome, 'cancelled');
  assert.equal(report.delegates.face, 'CPU'); assert.equal(report.camera.width, 1280);
  assert.equal(report.stages[0].ok, false); assert.equal(report.stages[1].durationMs, 50);
  assert.ok(report.events.some((e: { code: string }) => e.code === 'face-gpu-to-cpu'));
});

test('snapshots do not reset counters or double-count visible duration; finished reports freeze', () => {
  const r = recorder(); r.setContext(context('arms'), 0); r.inference(sample(), 100);
  assert.equal(r.snapshot(500).groups.arms.visibleMs, 500);
  assert.equal(r.snapshot(1000).groups.arms.visibleMs, 1000);
  r.finish('finished', 1000);
  const frozen = r.snapshot(2000);
  r.inference(sample(100), 3000); r.frame(3000); r.event('unwanted', 3000); r.finish('error', 4000);
  assert.deepEqual(r.snapshot(5000), frozen);
});

test('unsupported video frame observation stays unavailable rather than claiming a zero camera FPS', () => {
  const r = recorder(false); r.setContext(context('arms'), 0); r.finish('stopped', 1000);
  assert.equal(r.snapshot(1000).groups.arms.cameraFps, null);
});

test('unknown sample fields cannot leak frames or landmarks into the report', () => {
  const r = recorder(); r.setContext(context('arms'), 0);
  const payload = { ...sample(), cameraFrame: 'PRIVATE_FRAME', faceLandmarks: ['PRIVATE_LANDMARK'], expression: 'PRIVATE_EXPRESSION' };
  r.inference(payload, 100);
  const json = JSON.stringify(r.snapshot(200));
  assert.equal(json.includes('PRIVATE_'), false);
  assert.equal(json.includes('cameraFrame'), true); // Only the public cameraFrames counter exists.
  assert.equal(json.includes('faceLandmarks'), false);
});

test('long recordings are bounded but whole-run counts and truncation markers remain accurate', () => {
  const r = recorder(); r.setContext(context('head'), 0);
  for (let i = 0; i < DIAGNOSTIC_LIMITS.samples + 50; i++) r.inference(sample(20), i * 10);
  for (let i = 0; i < DIAGNOSTIC_LIMITS.events + 10; i++) r.event('test', i);
  const report = r.snapshot(50000);
  assert.equal(report.samples.length, DIAGNOSTIC_LIMITS.samples);
  assert.equal(report.dropped.samples, 50);
  assert.equal(report.groups.head.checks, DIAGNOSTIC_LIMITS.samples + 50);
  assert.equal(report.groups.head.faceMs.count, DIAGNOSTIC_LIMITS.series);
  assert.equal(report.events.length, DIAGNOSTIC_LIMITS.events);
  assert.ok(report.dropped.events > 0);
});

test('percentiles use the upper nearest rank and empty categories remain explicitly empty', () => {
  assert.deepEqual(summarize([]), { count: 0, mean: 0, p95: 0, max: 0 });
  assert.equal(summarize(Array.from({ length: 100 }, (_, i) => i + 1)).p95, 95);
  assert.equal(summarize([10, NaN, 30]).mean, 20);
});

test('tracking reasons and transfer latency are exported without accepting arbitrary text', () => {
  const r = recorder(); r.setContext(context('head'), 0);
  r.metadata('inferenceExecution', 'worker');
  r.inference({ ...sample(20), reasons: ['left-wrist-out-of-frame', 'left-wrist-out-of-frame', 'RAW_PRIVATE_COORDINATES'], captureMs: 2, roundTripMs: 34 }, 100);
  const report = r.snapshot(200);
  assert.equal(report.environment.inferenceExecution, 'worker');
  assert.deepEqual(report.samples[0].reasons, ['left-wrist-out-of-frame']);
  assert.equal(report.groups.head.failureReasons?.['left-wrist-out-of-frame'], 1);
  assert.equal(report.samples[0].captureMs, 2); assert.equal(report.samples[0].roundTripMs, 34);
  assert.equal(JSON.stringify(report).includes('RAW_PRIVATE_COORDINATES'), false);
  report.samples[0].reasons!.push('head-angle');
  assert.deepEqual(r.snapshot(200).samples[0].reasons, ['left-wrist-out-of-frame']);
});
