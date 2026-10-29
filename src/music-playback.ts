export interface VolumePlayer { setVolume(volume: number): void; pause(): void }
// A new play/selection cancels an older end-of-round fade, so it cannot pause new music.
export class MusicFade {
  private timer: ReturnType<typeof setInterval> | undefined;
  private restore: (() => void) | undefined;
  cancel() {
    clearInterval(this.timer); this.timer = undefined;
    const restore = this.restore; this.restore = undefined; restore?.();
  }
  end(player: VolumePlayer, volume: number, durationMs = 900) {
    this.cancel();
    const started = performance.now();
    this.restore = () => player.setVolume(volume);
    this.timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / durationMs);
      player.setVolume(Math.round(volume * (1 - progress)));
      if (progress >= 1) { player.pause(); this.cancel(); }
    }, 60);
  }
}
