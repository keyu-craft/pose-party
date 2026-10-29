import { TRACKING_TIMING } from './tracking-policy.ts';
export const TIMING = { readyMs: 1000, sessionMs: 60_000, holdMs: 1000, jitterGraceMs: TRACKING_TIMING.uncertaintyMs, edgeGraceMs: TRACKING_TIMING.edgeMs, transitionMs: 900, resultMs: 450 };
export type Phase = 'ready' | 'transition' | 'match' | 'hold' | 'success' | 'finished';
export interface RoundState {
  phase: Phase; progress: number; readyProgress: number; tracking: boolean;
  roundId: number; score: number; remainingMs: number;
}
export function targetMode(state: RoundState, running: boolean): 'rest' | 'pose' {
  return running && (state.phase === 'match' || state.phase === 'hold') ? 'pose' : 'rest';
}
export function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class RoundEngine {
  private phase: Phase = 'ready';
  private phaseStarted = 0;
  private readyStarted: number | null = null;
  private previous: number | null = null;
  private deadline: number | null = null;
  private progress = 0;
  private readyProgress = 0;
  private tracking = false;
  private roundId = 0;
  private score = 0;
  private remainingMs = TIMING.sessionMs;
  private heldMs = 0;
  private lastMatch: number | null = null;
  private uncertainSince: number | null = null;
  private uncertainGraceMs = TIMING.jitterGraceMs;

  reset(): RoundState {
    this.phase = 'ready'; this.phaseStarted = 0; this.readyStarted = null;
    this.previous = null; this.deadline = null; this.progress = 0;
    this.readyProgress = 0; this.tracking = false; this.roundId = 0;
    this.score = 0; this.remainingMs = TIMING.sessionMs;
    this.heldMs = 0; this.lastMatch = null; this.uncertainSince = null; this.uncertainGraceMs = TIMING.jitterGraceMs;
    return this.state();
  }

  // The clock advances even without camera frames or when the tab is hidden.
  // Expiry is checked before matching, so a late frame can never add a point.
  clock(now: number): RoundState {
    if (Number.isFinite(now) && this.deadline !== null) {
      this.remainingMs = Math.max(0, this.deadline - now);
      if (this.remainingMs === 0) {
        this.phase = 'finished'; this.progress = 0; this.readyProgress = 0;
      }
    }
    return this.state();
  }

  interrupt(now: number): RoundState {
    this.clock(now);
    if (this.phase === 'hold') this.phase = 'match';
    this.previous = null; this.readyStarted = null; this.readyProgress = 0;
    this.progress = 0; this.tracking = false;
    this.heldMs = 0; this.lastMatch = null; this.uncertainSince = null; this.uncertainGraceMs = TIMING.jitterGraceMs;
    return this.state();
  }

  update(valid: boolean, matches: boolean, facingScreen: boolean, now: number, decisiveMismatch = valid && !matches, uncertaintyGraceMs = TIMING.jitterGraceMs): RoundState {
    if (!Number.isFinite(now)) return this.interrupt(now);
    this.clock(now);
    if (this.phase === 'finished') return this.state();
    const gap = this.previous === null ? 0 : now - this.previous;
    if (gap < 0 || gap > 250) this.interrupt(now);
    this.previous = now; this.tracking = valid;

    if (this.phase === 'ready') {
      if (!facingScreen) { this.readyStarted = null; this.readyProgress = 0; }
      else {
        this.readyStarted ??= now;
        this.readyProgress = Math.min(1, (now - this.readyStarted) / TIMING.readyMs);
        if (this.readyProgress >= 1) {
          // Start the sixty-second clock exactly when the first target is revealed.
          this.deadline = now + TIMING.sessionMs; this.remainingMs = TIMING.sessionMs;
          this.phase = 'match'; this.phaseStarted = now; this.roundId++;
          this.readyProgress = 0;
        }
      }
    } else if (this.phase === 'success') {
      if (now - this.phaseStarted >= TIMING.resultMs) { this.phase = 'transition'; this.phaseStarted = now; this.progress = 0; }
    } else if (this.phase === 'transition') {
      if (now - this.phaseStarted >= TIMING.transitionMs) {
        this.phase = 'match'; this.roundId++; this.phaseStarted = now; this.progress = 0;
      }
    } else if (this.phase === 'match') {
      if (valid && matches) {
        this.phase = 'hold'; this.heldMs = 0; this.lastMatch = now;
        this.uncertainSince = null; this.progress = 0;
      }
    } else if (this.phase === 'hold') {
      if (!valid || !matches) {
        const allowance = Number.isFinite(uncertaintyGraceMs) ? Math.max(TIMING.jitterGraceMs, Math.min(TIMING.edgeGraceMs, uncertaintyGraceMs)) : TIMING.jitterGraceMs;
        this.uncertainGraceMs = this.uncertainSince === null ? allowance : Math.min(this.uncertainGraceMs, allowance);
        this.uncertainSince ??= now;
        this.lastMatch = null;
        if (decisiveMismatch || now - this.uncertainSince > this.uncertainGraceMs) {
          this.phase = 'match'; this.heldMs = 0; this.progress = 0; this.uncertainSince = null;
        }
      } else {
        if (this.uncertainSince !== null && now - this.uncertainSince > this.uncertainGraceMs) this.heldMs = 0;
        if (this.lastMatch !== null) this.heldMs += now - this.lastMatch;
        this.lastMatch = now; this.uncertainSince = null;
        this.progress = Math.min(1, this.heldMs / TIMING.holdMs);
        if (this.progress >= 1) { this.phase = 'success'; this.phaseStarted = now; this.score++; }
      }
    }
    return this.state();
  }

  private state(): RoundState {
    return { phase: this.phase, progress: this.progress, readyProgress: this.readyProgress,
      tracking: this.tracking, roundId: this.roundId, score: this.score, remainingMs: this.remainingMs };
  }
}
