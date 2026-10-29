import { COPY } from './i18n.ts';
import type { Language, CopyKey } from './i18n.ts';
import { BUILTIN_MUSIC, MusicLibrary, nextMusicIndex } from './music-data.ts';
import { MusicPlayer } from './music-player.ts';
import { publicAsset } from './public-assets.ts';
import type { MusicTrack } from './music-data.ts';

const playable = (track: MusicTrack): MusicTrack => track.kind === 'builtin' ? { ...track, src: publicAsset(track.src) } : track;

export class MusicTools {
  private readonly library = new MusicLibrary();
  private readonly player: MusicPlayer;
  private readonly audio = document.createElement('audio');
  private opened = false;
  private disposed = false;
  private notice: CopyKey | null = null;
  private readonly onToggle = () => this.toggle();
  private readonly onVisibility = () => { if (document.hidden) this.pause(); };
  private readonly onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (this.opened && !this.panel.contains(target) && !this.toggleButton.contains(target)) this.toggle(false, false);
  };
  private readonly onKey = (event: KeyboardEvent) => { if (this.opened && event.key === 'Escape' && !document.querySelector('dialog[open]')) { this.toggle(false); event.preventDefault(); } };
  private readonly onClick = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-music-action]')?.dataset.musicAction;
    this.notice = null;
    if (action === 'close') this.toggle(false);
    if (action === 'play') { if (this.player.active) this.pause(); else void this.player.play(); }
    if (action === 'previous' || action === 'next') this.step(action === 'next' ? 1 : -1);
    if (action === 'add') this.node<HTMLInputElement>('music-files').click();
    if (action === 'clear') {
      if (this.player.track.kind === 'local') this.player.select(playable(BUILTIN_MUSIC[0]), false);
      this.library.clearLocal(); this.updateTracks(); this.refresh();
    }
  };
  private readonly onChange = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'music-track') {
      const track = this.library.tracks.find(track => track.id === target.value);
      if (track) { this.notice = null; this.player.select(playable(track), this.player.active); }
    }
    if (target.id === 'music-files') {
      const input = target as HTMLInputElement, files = Array.from(input.files ?? []); if (!files.length) return;
      const result = this.library.add(files); input.value = '';
      this.notice = result.rejected ? 'musicSkipped' : result.duplicates && !result.firstId ? 'musicDuplicate' : null;
      this.updateTracks();
      if (result.firstId) this.player.select(this.library.tracks.find(track => track.id === result.firstId)!, this.player.active);
      this.refresh();
    }
  };
  private readonly onVolume = () => {
    this.player.setVolume(Number(this.node<HTMLInputElement>('music-volume').value));
    try { localStorage.setItem('pose-party-music-v2', JSON.stringify({ volume: this.player.volume })); } catch { /* Optional preference. */ }
  };
  constructor(private readonly panel: HTMLElement, private readonly toggleButton: HTMLButtonElement, _layout: HTMLElement, private readonly language: () => Language, private readonly report: (code: string) => void = () => {}) {
    panel.innerHTML = `
      <div class="music-heading"><h2 id="music-title">♫ <span data-music-copy="musicTitle"></span></h2><button class="report-close" data-music-action="close">×</button></div>
      <label class="sr-only" for="music-track" data-music-copy="musicTracks"></label><select id="music-track"></select>
      <p class="music-status" id="music-status" role="status" aria-live="polite"></p>
      <div class="music-transport"><button data-music-action="previous" id="music-previous">⏮</button><button data-music-action="play" id="music-play">▶</button><button data-music-action="next" id="music-next">⏭</button><label for="music-volume" class="sr-only" data-music-copy="musicVolume"></label><input id="music-volume" type="range" min="0" max="100" step="1"><output id="music-volume-value" for="music-volume"></output></div>
      <div class="music-local"><button class="music-add" data-music-action="add" data-music-copy="musicAdd"></button><button class="music-clear" data-music-action="clear" id="music-clear" data-music-copy="musicClear" hidden></button><input id="music-files" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm" multiple hidden></div>
      <p class="music-note" data-music-copy="musicNote"></p>
      <details class="music-credits"><summary data-music-copy="musicCredits"></summary><p id="music-credit-intro"></p><ul id="music-credit-tracks"></ul><p><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> · <a id="music-full-credits" target="_blank" rel="noopener" data-music-copy="musicFullCredits"></a></p></details>`;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'music-title'); toggleButton.setAttribute('aria-controls', panel.id);
    this.audio.hidden = true; this.audio.setAttribute('aria-hidden', 'true'); panel.append(this.audio);
    this.node<HTMLAnchorElement>('music-full-credits').href = publicAsset('music/CREDITS.md');
    this.player = new MusicPlayer(this.audio, playable(BUILTIN_MUSIC[0]), () => this.refresh(), () => this.step(1), report);
    try {
      const saved = JSON.parse(localStorage.getItem('pose-party-music-v2') ?? localStorage.getItem('pose-party-music-v1') ?? '{}');
      if (typeof saved.volume === 'number') this.player.setVolume(saved.volume);
    } catch { /* Optional preference. */ }
    const credits = this.node('music-credit-tracks');
    for (const track of BUILTIN_MUSIC) {
      const item = document.createElement('li'), link = document.createElement('a');
      link.textContent = track.title; link.href = track.source!; link.target = '_blank'; link.rel = 'noopener'; item.append(link); credits.append(item);
    }
    toggleButton.addEventListener('click', this.onToggle); panel.addEventListener('click', this.onClick); panel.addEventListener('change', this.onChange);
    this.node('music-volume').addEventListener('input', this.onVolume);
    document.addEventListener('visibilitychange', this.onVisibility); document.addEventListener('pointerdown', this.onOutside); document.addEventListener('keydown', this.onKey);
    this.updateTracks(); this.refresh();
  }
  private node<T extends HTMLElement>(id: string) { return this.panel.querySelector<T>(`#${id}`)!; }
  private text(key: CopyKey) { return COPY[this.language()][key]; }
  private updateTracks() {
    const select = this.node<HTMLSelectElement>('music-track'); select.replaceChildren();
    for (const kind of ['builtin', 'local'] as const) {
      const tracks = this.library.tracks.filter(track => track.kind === kind); if (!tracks.length) continue;
      const group = document.createElement('optgroup'); group.label = this.text(kind === 'builtin' ? 'musicBuiltIn' : 'musicLocal');
      for (const track of tracks) group.append(new Option(track.style ? `${this.text(track.style)} · ${track.title}` : track.title, track.id));
      select.append(group);
    }
    select.value = this.player.track.id;
  }
  private step(direction: 1 | -1) {
    if (this.disposed || document.hidden) return;
    const tracks = this.library.tracks, index = tracks.findIndex(track => track.id === this.player.track.id);
    this.notice = null; this.player.select(playable(tracks[nextMusicIndex(index, tracks.length, direction)]), true);
  }
  translate() { this.updateTracks(); this.refresh(); }
  private refresh() {
    if (!this.player || this.disposed) return;
    this.toggleButton.setAttribute('aria-expanded', String(this.opened)); this.toggleButton.setAttribute('aria-label', this.text('musicTitle')); this.toggleButton.title = this.text('musicTitle');
    this.toggleButton.classList.toggle('selected', this.opened); this.toggleButton.classList.toggle('is-playing', this.player.active);
    for (const element of this.panel.querySelectorAll<HTMLElement>('[data-music-copy]')) element.textContent = this.text(element.dataset.musicCopy as CopyKey);
    this.panel.querySelector('[data-music-action="close"]')!.setAttribute('aria-label', this.text('musicClose'));
    this.node<HTMLSelectElement>('music-track').value = this.player.track.id;
    const key: CopyKey = this.player.phase === 'playing' ? 'musicPlaying' : this.player.phase === 'loading' ? 'musicLoading' : this.player.phase === 'error' ? 'musicError' : this.player.phase === 'blocked' ? 'musicBlocked' : 'musicPaused';
    this.node('music-status').textContent = this.text(this.notice ?? key);
    for (const [id, key] of [['music-previous', 'musicPrevious'], ['music-next', 'musicNext'], ['music-play', this.player.active ? 'musicPause' : 'musicPlay']] as const) { this.node(id).setAttribute('aria-label', this.text(key)); this.node(id).title = this.text(key); }
    this.node('music-play').textContent = this.player.active ? 'Ⅱ' : '▶';
    this.node<HTMLInputElement>('music-volume').value = String(this.player.volume); this.node('music-volume-value').textContent = `${this.player.volume}%`;
    this.node('music-clear').hidden = this.library.localCount === 0; this.node('music-credit-intro').textContent = this.text('musicCreditIntro');
  }
  private toggle(open = !this.opened, focus = true) { this.opened = open; this.panel.hidden = !open; if (!open && focus) this.toggleButton.focus(); this.refresh(); }
  get profileStatus() { return this.player.profileStatus; }
  pause() { this.player.pause(); }
  endRound() { this.player.endRound(); }
  dispose() {
    this.player.dispose(); this.disposed = true; this.library.clearLocal();
    this.toggleButton.removeEventListener('click', this.onToggle); this.panel.removeEventListener('click', this.onClick); this.panel.removeEventListener('change', this.onChange); this.node('music-volume').removeEventListener('input', this.onVolume);
    document.removeEventListener('visibilitychange', this.onVisibility); document.removeEventListener('pointerdown', this.onOutside); document.removeEventListener('keydown', this.onKey);
  }
}
