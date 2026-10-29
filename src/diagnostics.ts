import { TRACKING_REASONS } from './tracking-reasons.ts';
export type ProfileMode = 'startup' | 'ready' | 'arms' | 'head' | 'transition';
export type RunOutcome = 'active' | 'finished' | 'stopped' | 'cancelled' | 'error' | 'pagehide';
export interface ProfileContext { mode: ProfileMode; phase: string; poseId: string | null; roundId: number }
export interface Stats { count: number; mean: number; p95: number; max: number }
export interface InferenceSample {
  atMs: number; mode: ProfileMode; phase: string; poseId: string | null; roundId: number;
  poseMs: number; faceMs: number | null; matchingMs: number; drawingMs: number; totalMs: number;
  valid: boolean; matched: boolean;
  reasons?: string[]; captureMs?: number; roundTripMs?: number;
}
export interface ProfileEvent extends ProfileContext { atMs: number; type: string; durationMs?: number; code?: string }
export interface SecondBucket { second: number; mode: ProfileMode; checks: number; poseMs: number; faceMs: number; uiMs: number; slowFrames: number }
export interface GroupSummary {
  visibleMs: number; frames: number; displayFps: number | null; cameraFrames: number; cameraFps: number | null;
  checks: number; checksPerSecond: number | null; invalidChecks: number; slowFrames: number;
  poseMs: Stats; faceMs: Stats; matchingMs: Stats; drawingMs: Stats; totalMs: Stats; uiMs: Stats; frameGapMs: Stats;
  longTasks: number; longTaskMs: number;
  failureReasons?: Record<string, number>;
}
export interface RunReport {
  schemaVersion: 1; id: string; startedAt: string; elapsedMs: number; outcome: RunOutcome;
  environment: Record<string, string | number | boolean | null>;
  delegates: { pose: 'GPU' | 'CPU' | null; face: 'GPU' | 'CPU' | null };
  capabilities: { longTasks: boolean; videoFrameCallbacks: boolean };
  camera: { width: number; height: number; frameRate: number | null } | null;
  stages: { stage: string; atMs: number; durationMs: number; ok: boolean }[];
  groups: Record<ProfileMode, GroupSummary>; timeline: SecondBucket[];
  events: ProfileEvent[]; samples: InferenceSample[];
  dropped: { samples: number; events: number; timeline: number };
  notes: string[];
}
export const PROFILE_MODES: ProfileMode[] = ['startup', 'ready', 'arms', 'head', 'transition'];
export const DIAGNOSTIC_LIMITS = { samples: 4000, events: 300, timeline: 600, series: 4000, slowFrameMs: 100 };
const round = (n: number) => Math.round(n * 100) / 100;
const duration = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;
export function summarize(values: readonly number[]): Stats {
  const sorted = values.filter(Number.isFinite).map(n => Math.max(0, n)).sort((a, b) => a - b);
  return sorted.length ? { count: sorted.length, mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length), p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]), max: round(sorted.at(-1)!) } : { count: 0, mean: 0, p95: 0, max: 0 };
}
interface Group {
  visibleMs: number; frames: number; cameraFrames: number; checks: number; invalidChecks: number;
  slowFrames: number; longTasks: number; longTaskMs: number;
  failureReasons: Record<string, number>;
  series: Record<'poseMs' | 'faceMs' | 'matchingMs' | 'drawingMs' | 'totalMs' | 'uiMs' | 'frameGapMs', number[]>;
}
function newGroup(): Group {
  return { visibleMs: 0, frames: 0, cameraFrames: 0, checks: 0, invalidChecks: 0, slowFrames: 0, longTasks: 0, longTaskMs: 0, failureReasons: {},
    series: { poseMs: [], faceMs: [], matchingMs: [], drawingMs: [], totalMs: [], uiMs: [], frameGapMs: [] } };
}

// Only numbers, run context and timings are accepted: no frames, landmarks,
// expression coefficients, camera identifiers, URLs or free-form error messages.
export class PerformanceRecorder {
  private readonly groups = Object.fromEntries(PROFILE_MODES.map(m => [m, newGroup()])) as Record<ProfileMode, Group>;
  private readonly samples: InferenceSample[] = [];
  private readonly events: ProfileEvent[] = [];
  private readonly stages: RunReport['stages'] = [];
  private readonly timeline = new Map<string, SecondBucket>();
  private readonly history: { at: number; context: ProfileContext; visible: boolean }[] = [];
  private context: ProfileContext = { mode: 'startup', phase: 'loading', poseId: null, roundId: 0 };
  private visible = true;
  private changedAt: number;
  private lastFrame: number | null = null;
  private endedAt: number | null = null;
  private outcome: RunOutcome = 'active';
  private delegates: RunReport['delegates'] = { pose: null, face: null };
  private camera: RunReport['camera'] = null;
  private dropped = { samples: 0, events: 0, timeline: 0 };
  readonly id: string;
  readonly startedAt: string;
  private readonly origin: number;
  private readonly environment: RunReport['environment'];
  private readonly capabilities: RunReport['capabilities'];

  constructor(id: string, startedAt: string, origin: number,
    environment: RunReport['environment'], capabilities: RunReport['capabilities']) {
    this.id = id; this.startedAt = startedAt; this.origin = origin;
    this.environment = environment; this.capabilities = capabilities;
    this.changedAt = origin; this.history.push({ at: origin, context: { ...this.context }, visible: true });
  }
  private active() { return this.endedAt === null; }
  private relative(now: number) { return round(Math.max(0, now - this.origin)); }
  private series(group: Group, key: keyof Group['series'], value: number) {
    const list = group.series[key]; if (list.length >= DIAGNOSTIC_LIMITS.series) list.shift(); list.push(duration(value));
  }
  private bucket(now: number, mode = this.context.mode): SecondBucket | null {
    const second = Math.floor(Math.max(0, now - this.origin) / 1000), key = `${second}/${mode}`;
    if (!this.timeline.has(key)) {
      if (this.timeline.size >= DIAGNOSTIC_LIMITS.timeline) { this.dropped.timeline++; return null; }
      this.timeline.set(key, { second, mode, checks: 0, poseMs: 0, faceMs: 0, uiMs: 0, slowFrames: 0 });
    }
    return this.timeline.get(key)!;
  }
  setContext(context: ProfileContext, now: number, visible = this.visible) {
    if (!this.active()) return;
    if (context.mode === this.context.mode && context.phase === this.context.phase && context.poseId === this.context.poseId && context.roundId === this.context.roundId && visible === this.visible) return;
    if (this.visible) this.groups[this.context.mode].visibleMs += duration(now - this.changedAt);
    const changedMode = context.mode !== this.context.mode || visible !== this.visible;
    this.context = { ...context }; this.visible = visible; this.changedAt = now;
    if (changedMode) this.lastFrame = null; // Do not blame a hidden tab or mode boundary for a frame gap.
    this.history.push({ at: now, context: { ...context }, visible });
    if (this.history.length > 1000) this.history.shift();
    this.event('context', now);
  }
  visibility(visible: boolean, now: number) { this.setContext(this.context, now, visible); }
  frame(now: number) {
    if (!this.active() || !this.visible) return;
    const group = this.groups[this.context.mode]; group.frames++;
    if (this.lastFrame !== null) {
      const gap = duration(now - this.lastFrame); this.series(group, 'frameGapMs', gap);
      if (gap >= DIAGNOSTIC_LIMITS.slowFrameMs) {
        group.slowFrames++; const bucket = this.bucket(now); if (bucket) bucket.slowFrames++;
        this.event('frame-gap', now, gap);
      }
    }
    this.lastFrame = now;
  }
  videoFrames(count: number) {
    if (this.active() && this.visible && Number.isFinite(count)) this.groups[this.context.mode].cameraFrames += Math.max(0, Math.floor(count));
  }
  ui(ms: number, now: number) {
    if (!this.active() || !this.visible) return;
    this.series(this.groups[this.context.mode], 'uiMs', ms);
    const bucket = this.bucket(now); if (bucket) bucket.uiMs += duration(ms);
  }
  inference(sample: Omit<InferenceSample, 'atMs' | keyof ProfileContext>, now: number) {
    if (!this.active() || !this.visible) return;
    const s: InferenceSample = { ...this.context, atMs: this.relative(now), poseMs: duration(sample.poseMs), faceMs: sample.faceMs === null ? null : duration(sample.faceMs), matchingMs: duration(sample.matchingMs), drawingMs: duration(sample.drawingMs), totalMs: duration(sample.totalMs), valid: !!sample.valid, matched: !!sample.matched };
    s.reasons = [...new Set((sample.reasons ?? []).filter(reason => TRACKING_REASONS.has(reason)))];
    if (sample.captureMs !== undefined) s.captureMs = duration(sample.captureMs);
    if (sample.roundTripMs !== undefined) s.roundTripMs = duration(sample.roundTripMs);
    const group = this.groups[s.mode]; group.checks++; if (!s.valid) group.invalidChecks++;
    for (const reason of s.reasons) group.failureReasons[reason] = (group.failureReasons[reason] ?? 0) + 1;
    for (const key of ['poseMs', 'matchingMs', 'drawingMs', 'totalMs'] as const) this.series(group, key, s[key]);
    if (s.faceMs !== null) this.series(group, 'faceMs', s.faceMs);
    if (this.samples.length >= DIAGNOSTIC_LIMITS.samples) { this.samples.shift(); this.dropped.samples++; }
    this.samples.push(s);
    const bucket = this.bucket(now); if (bucket) { bucket.checks++; bucket.poseMs += s.poseMs; bucket.faceMs += s.faceMs ?? 0; }
  }
  event(type: string, now: number, durationMs?: number, code?: string) {
    if (!this.active()) return;
    if (this.events.length >= DIAGNOSTIC_LIMITS.events) { this.events.shift(); this.dropped.events++; }
    this.events.push({ ...this.context, atMs: this.relative(now), type, ...(durationMs === undefined ? {} : { durationMs: round(duration(durationMs)) }), ...(code ? { code } : {}) });
  }
  longTask(start: number, ms: number) {
    if (!this.active() || start < this.origin) return;
    const at = [...this.history].reverse().find(h => h.at <= start);
    if (!at?.visible) return;
    const group = this.groups[at.context.mode]; group.longTasks++; group.longTaskMs += duration(ms);
    if (this.events.length >= DIAGNOSTIC_LIMITS.events) { this.events.shift(); this.dropped.events++; }
    this.events.push({ ...at.context, atMs: this.relative(start), type: 'long-task', durationMs: round(duration(ms)) });
  }
  stage(stage: string, start: number, end: number, ok: boolean) {
    if (this.active() && this.stages.length < 40) this.stages.push({ stage, atMs: this.relative(start), durationMs: round(duration(end - start)), ok });
  }
  delegate(model: 'pose' | 'face', delegate: 'GPU' | 'CPU') { if (this.active()) this.delegates[model] = delegate; }
  metadata(key: 'optimizationVersion' | 'inferenceExecution' | 'backgroundMusic', value: string) { if (this.active()) this.environment[key] = value; }
  setCamera(width: number, height: number, frameRate?: number) { if (this.active()) this.camera = { width, height, frameRate: frameRate && Number.isFinite(frameRate) ? frameRate : null }; }
  finish(outcome: Exclude<RunOutcome, 'active'>, now: number) {
    if (!this.active()) return;
    this.event('end', now, undefined, outcome);
    if (this.visible) this.groups[this.context.mode].visibleMs += duration(now - this.changedAt);
    this.endedAt = now; this.outcome = outcome;
  }
  snapshot(now: number): RunReport {
    const end = this.endedAt ?? now;
    const groups = Object.fromEntries(PROFILE_MODES.map(mode => {
      const group = this.groups[mode];
      const visibleMs = group.visibleMs + (this.active() && this.visible && this.context.mode === mode ? duration(end - this.changedAt) : 0);
      const rate = (count: number) => visibleMs > 0 ? round(count * 1000 / visibleMs) : null;
      return [mode, { visibleMs: round(visibleMs), frames: group.frames, displayFps: rate(group.frames), cameraFrames: group.cameraFrames,
        cameraFps: this.capabilities.videoFrameCallbacks ? rate(group.cameraFrames) : null,
        checks: group.checks, checksPerSecond: rate(group.checks), invalidChecks: group.invalidChecks, slowFrames: group.slowFrames,
        ...Object.fromEntries(Object.entries(group.series).map(([key, values]) => [key, summarize(values)])),
        longTasks: group.longTasks, longTaskMs: round(group.longTaskMs), failureReasons: { ...group.failureReasons } }];
    })) as RunReport['groups'];
    return { schemaVersion: 1, id: this.id, startedAt: this.startedAt, elapsedMs: round(duration(end - this.origin)), outcome: this.outcome,
      environment: { ...this.environment }, delegates: { ...this.delegates }, capabilities: { ...this.capabilities }, camera: this.camera ? { ...this.camera } : null,
      stages: this.stages.map(s => ({ ...s })), groups,
      timeline: [...this.timeline.values()].map(b => ({ ...b, poseMs: round(b.poseMs), faceMs: round(b.faceMs), uiMs: round(b.uiMs) })),
      events: this.events.map(e => ({ ...e })), samples: this.samples.map(s => ({ ...s, reasons: [...(s.reasons ?? [])] })), dropped: { ...this.dropped },
      notes: ['Local timings only. No camera frames, landmarks, expressions, device IDs or network uploads.',
        'Model times measure synchronous API calls in the recorded backend, not isolated GPU execution. Total latency includes capture/worker round trip for worker runs. UI timings measure JS updates, not the complete compositor pipeline.',
        'Failure reasons contain only category codes, not landmark coordinates, scores or face geometry. Multiple reasons may occur in one check.',
        'Inference pacing differs by mode: arms <=25 checks/s, head and preparation <=14.3 checks/s. Compare model timings as well as rates.',
        'Visible frame gaps >=100ms are flagged. Hidden intervals are excluded from visible FPS. Long-task data depends on browser support.',
        'Percentiles use at most the latest 4000 measurements per metric; counters and visible durations cover the whole run.'] };
  }
}
