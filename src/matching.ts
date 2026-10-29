import { ARM_SEGMENTS, angleDistance } from './poses.ts';
import type { Point, Pose } from './poses.ts';
import { facePlayerIssue } from './readiness.ts';
import { outsideEdges, uncertaintyGrace, TRACKING_TIMING } from './tracking-policy.ts';

export const MATCH_LIMITS = {
  armEnter: 28, armKeep: 36, armWrong: 44,
  headEnter: 10, headKeep: 15, headWrong: 22,
  smoothingMs: 80, missingGraceMs: TRACKING_TIMING.uncertaintyMs,
};
const REQUIRED = [11, 12, 13, 14, 15, 16];
interface Features { arms: number[]; head: number | null; headIssue?: string }
export interface MatchResult {
  valid: boolean; matches: boolean; armMatches: boolean; headMatches: boolean;
  decisiveMismatch: boolean; score: number; reasons: string[];
}
const invalid = (reasons: string[] = []): MatchResult => ({ valid: false, matches: false, armMatches: false, headMatches: false, decisiveMismatch: false, score: 0, reasons });
const signedAngle = (a: number) => ((a + 540) % 360) - 180;

function measure(body: readonly Point[], face: readonly Point[], width: number, height: number, headFailureReason?: string): Features | { reasons: string[] } {
  if (width <= 0 || height <= 0) return { reasons: ['invalid-frame-size'] };
  if (body.length < 17) return { reasons: ['body-not-found'] };
  const names = ['left-shoulder', 'right-shoulder', 'left-elbow', 'right-elbow', 'left-wrist', 'right-wrist'];
  const reasons: string[] = [];
  REQUIRED.forEach((index, i) => {
    const p = body[index], name = names[i];
    if (!p) reasons.push(`${name}-missing`);
    else if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) reasons.push(`${name}-non-finite`);
    else if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) reasons.push(`${name}-out-of-frame`, ...outsideEdges(p));
    else if ((p.visibility ?? 0) < 0.65) reasons.push(`${name}-low-confidence`);
  });
  if (reasons.length) return { reasons };
  const point = (p: Point) => ({ x: (1 - p.x) * width, y: p.y * height });
  const left = point(body[11]), right = point(body[12]);
  const shoulderSize = Math.hypot(right.x - left.x, right.y - left.y);
  const shoulderAngle = Math.atan2(right.y - left.y, right.x - left.x) * 180 / Math.PI;
  if (shoulderSize < width * 0.06) return { reasons: ['shoulders-too-small'] };
  if (Math.abs(shoulderAngle) > 30) return { reasons: ['shoulders-too-tilted'] };
  const arms: number[] = [];
  for (const [index, [a, b]] of ARM_SEGMENTS.entries()) {
    const from = point(body[a]), to = point(body[b]);
    if (Math.hypot(to.x - from.x, to.y - from.y) < shoulderSize * 0.15) return { reasons: [['left-upper-arm-collapsed', 'left-forearm-collapsed', 'right-upper-arm-collapsed', 'right-forearm-collapsed'][index]] };
    // Work relative to shoulders rather than the screen, so a small body lean
    // neither changes the arm target nor counts as an independent head tilt.
    arms.push(signedAngle(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI - shoulderAngle));
  }
  let head: number | null = null;
  const headIssue = headFailureReason ?? facePlayerIssue(face, body, width, height);
  if (!headIssue) {
    const eyes = [point(face[33]), point(face[263])].sort((a, b) => a.x - b.x);
    head = signedAngle(Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x) * 180 / Math.PI - shoulderAngle);
  }
  return { arms, head, headIssue: headIssue ?? undefined };
}

function compare(raw: Features, smooth: Features, pose: Pose, keeping: boolean): MatchResult {
  const rawErrors = raw.arms.map((a, i) => angleDistance(a, pose.angles[i]));
  const smoothErrors = smooth.arms.map((a, i) => angleDistance(a, pose.angles[i]));
  const armLimit = keeping ? MATCH_LIMITS.armKeep : MATCH_LIMITS.armEnter;
  const armMatches = rawErrors.every(e => e <= armLimit) && smoothErrors.every(e => e <= armLimit);
  if (pose.headTilt !== undefined && (raw.head === null || smooth.head === null)) return { ...invalid([raw.headIssue ?? 'face-missing', ...(!armMatches ? ['arms-angle'] : [])]), armMatches, decisiveMismatch: rawErrors.some(e => e > MATCH_LIMITS.armWrong) };
  const headError = pose.headTilt === undefined ? 0 : angleDistance(raw.head!, pose.headTilt);
  const smoothedHeadError = pose.headTilt === undefined ? 0 : angleDistance(smooth.head!, pose.headTilt);
  const headLimit = keeping ? MATCH_LIMITS.headKeep : MATCH_LIMITS.headEnter;
  const headMatches = headError <= headLimit && smoothedHeadError <= headLimit;
  return {
    valid: true, matches: armMatches && headMatches, armMatches, headMatches,
    reasons: [...(!armMatches ? ['arms-angle'] : []), ...(!headMatches ? ['head-angle'] : [])],
    decisiveMismatch: rawErrors.some(e => e > MATCH_LIMITS.armWrong) || headError > MATCH_LIMITS.headWrong,
    score: Math.round(Math.max(0, 1 - Math.max(...rawErrors, headError) / 90) * 100),
  };
}

export function evaluatePose(body: readonly Point[], pose: Pose, width: number, height: number, face: readonly Point[] = []): MatchResult {
  const features = measure(body, face, width, height);
  return 'reasons' in features ? invalid(features.reasons) : compare(features, features, pose, false);
}

export class PoseMatcher {
  private features: Features | null = null;
  private last: number | null = null;
  private poseId = '';
  private size = '';
  private keeping = false;
  private invalidSince: number | null = null;
  private invalidGraceMs = MATCH_LIMITS.missingGraceMs;
  reset() { this.features = null; this.last = null; this.poseId = ''; this.size = ''; this.keeping = false; this.invalidSince = null; this.invalidGraceMs = MATCH_LIMITS.missingGraceMs; }
  private noteInvalid(now: number, reasons: readonly string[]) {
    const allowance = uncertaintyGrace(reasons);
    this.invalidGraceMs = this.invalidSince === null ? allowance : Math.min(this.invalidGraceMs, allowance);
    this.invalidSince ??= now;
  }

  update(body: readonly Point[], face: readonly Point[], pose: Pose, width: number, height: number, now: number, headFailureReason?: string): MatchResult {
    if (!Number.isFinite(now)) { this.reset(); return invalid(); }
    const size = `${width}/${height}`;
    if (this.poseId !== pose.id || this.size !== size || (this.last !== null && (now - this.last > 250 || now < this.last))) this.reset();
    this.poseId = pose.id; this.size = size;
    if (this.invalidSince !== null && now - this.invalidSince > this.invalidGraceMs) this.keeping = false;
    const raw = measure(body, face, width, height, headFailureReason);
    if ('reasons' in raw) { this.noteInvalid(now, raw.reasons); this.features = null; this.last = null; return invalid(raw.reasons); }
    const alpha = this.last === null ? 1 : 1 - Math.exp(-(now - this.last) / MATCH_LIMITS.smoothingMs);
    const previous = this.features;
    const smooth: Features = previous ? {
      headIssue: raw.headIssue,
      arms: raw.arms.map((angle, i) => previous.arms[i] + signedAngle(angle - previous.arms[i]) * alpha),
      head: raw.head === null ? null : previous.head === null ? raw.head : previous.head + signedAngle(raw.head - previous.head) * alpha,
    } : raw;
    const result = compare(raw, smooth, pose, this.keeping);
    if (result.valid) { this.invalidSince = null; this.invalidGraceMs = MATCH_LIMITS.missingGraceMs; } else this.noteInvalid(now, result.reasons);
    // Raw large errors always win over smoothing; deliberate wrong moves reset
    // immediately. Missing landmarks never borrow an older 'good' frame.
    if (result.decisiveMismatch) { this.features = raw; this.keeping = false; }
    else { this.features = smooth; if (result.valid) this.keeping = result.matches; }
    this.last = now;
    return result;
  }
}
