import type { MusicTrack } from './music-data.ts';
import { MusicFade } from './music-playback.ts';

export type MusicPhase = 'paused' | 'loading' | 'playing' | 'blocked' | 'error';
export class MusicPlayer {
  phase: MusicPhase = 'paused';
  volume = 35;
  track: MusicTrack;
  private request = 0;
  private wantsPlay = false;
  private autoAdvance = true;
  private disposed = false;
  private readonly audio: HTMLAudioElement;
  private readonly changed: () => void;
  private readonly next: () => void;
  private readonly report: (code: string) => void;
  private fade = new MusicFade();
  private readonly onPlaying = () => {
    if (!this.wantsPlay || this.disposed) { this.audio.pause(); return; }
    this.setPhase('playing');
  };
  private readonly onWaiting = () => { if (this.wantsPlay) this.setPhase('loading'); };
  private readonly onPause = () => { if (this.audio.paused && this.phase !== 'error' && this.phase !== 'blocked') this.setPhase('paused'); };
  private readonly onError = () => { this.request++; this.wantsPlay = false; this.fade.cancel(); this.setPhase('error'); };
  private readonly onEnded = () => {
    const advance = this.autoAdvance && this.wantsPlay && !this.disposed;
    this.wantsPlay = false; this.setPhase('paused'); if (advance) this.next();
  };
  private readonly events = { playing: this.onPlaying, waiting: this.onWaiting, pause: this.onPause, error: this.onError, ended: this.onEnded };
  constructor(audio: HTMLAudioElement, track: MusicTrack, changed: () => void, next: () => void, report: (code: string) => void = () => {}) {
    this.audio = audio; this.changed = changed; this.next = next; this.report = report;
    this.track = track; audio.preload = 'none'; audio.src = track.src; audio.volume = this.volume / 100;
    for (const [name, handler] of Object.entries(this.events)) audio.addEventListener(name, handler);
  }
  private setPhase(phase: MusicPhase) {
    if (this.phase !== phase) { this.phase = phase; this.report(`${this.track.kind}-${phase}`); }
    this.changed();
  }
  select(track: MusicTrack, autoplay: boolean) {
    this.pause(); this.track = track; this.audio.src = track.src;
    this.report(`source-${track.kind}`); this.setPhase('paused'); if (autoplay) void this.play();
  }
  async play() {
    if (this.disposed) return;
    const request = ++this.request; this.fade.cancel(); this.wantsPlay = true; this.autoAdvance = true;
    if (this.audio.ended) this.audio.currentTime = 0;
    this.setPhase('loading');
    try {
      await this.audio.play();
      if (request !== this.request || this.disposed) {
        // A delayed promise must not pause a newer play request.
        if (!this.wantsPlay) this.audio.pause(); return;
      }
      if (!this.audio.paused) this.setPhase('playing');
    } catch (error) {
      if (request !== this.request || this.disposed) return;
      this.wantsPlay = false; this.setPhase(error instanceof Error && error.name === 'NotAllowedError' ? 'blocked' : 'error');
    }
  }
  pause() { this.request++; this.wantsPlay = false; this.fade.cancel(); this.audio.pause(); this.setPhase('paused'); }
  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.fade.cancel(); this.volume = Math.max(0, Math.min(100, volume)); this.audio.volume = this.volume / 100; this.changed();
  }
  endRound() {
    this.autoAdvance = false;
    if (this.phase === 'playing' && !this.audio.paused) this.fade.end({ setVolume: v => { this.audio.volume = v / 100; }, pause: () => this.pause() }, this.volume);
    else this.pause();
  }
  get active() { return this.wantsPlay && (this.phase === 'playing' || this.phase === 'loading'); }
  get profileStatus() { return `${this.track.kind}-${this.phase}`; }
  dispose() {
    this.disposed = true; this.pause();
    for (const [name, handler] of Object.entries(this.events)) this.audio.removeEventListener(name, handler);
    this.audio.removeAttribute('src'); this.audio.load();
  }
}
