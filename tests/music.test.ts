import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BUILTIN_MUSIC, MusicLibrary, MAX_LOCAL_TRACKS, isAudioFile, nextMusicIndex } from '../src/music-data.ts';
import { MusicPlayer } from '../src/music-player.ts';
import { MusicFade } from '../src/music-playback.ts';
import { COPY } from '../src/i18n.ts';

class FakeAudio extends EventTarget {
  src = ''; preload = ''; volume = 1; paused = true; ended = false; currentTime = 0;
  operation: () => Promise<void> = async () => {};
  play() { this.paused = false; return this.operation(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute() { this.src = ''; }
  load() {}
  emit(name: string) { this.dispatchEvent(new Event(name)); }
}
function setup(next = () => {}) {
  const audio = new FakeAudio(), events: string[] = [];
  const player = new MusicPlayer(audio as unknown as HTMLAudioElement, BUILTIN_MUSIC[0], () => {}, next, code => events.push(code));
  return { audio, player, events };
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject };
}

test('three distinct bundled recordings are real local MP3s with verifiable credits', () => {
  assert.equal(BUILTIN_MUSIC.length, 3); assert.equal(new Set(BUILTIN_MUSIC.map(t => t.style)).size, 3);
  const credits = readFileSync(new URL('../public/music/CREDITS.md', import.meta.url), 'utf8');
  for (const track of BUILTIN_MUSIC) {
    assert.ok(track.src.startsWith('/music/')); assert.equal(track.kind, 'builtin');
    const bytes = readFileSync(new URL(`../public${track.src}`, import.meta.url));
    assert.ok(bytes.length > 1_000_000); assert.equal(bytes.subarray(0,3).toString(), 'ID3');
    assert.ok(credits.includes(createHash('sha256').update(bytes).digest('hex'))); assert.ok(credits.includes(track.title));
  }
  assert.ok(credits.includes('https://creativecommons.org/licenses/by/4.0/'));
  for (const key of Object.keys(COPY.en).filter(k => k.startsWith('music')) as (keyof typeof COPY.en)[]) assert.ok(COPY.zh[key]);
});
test('local selection accepts audio and common untyped extensions while rejecting empty or non-audio files', () => {
  assert.ok(isAudioFile(new File(['x'], 'song.mp3', { type: 'audio/mpeg' })));
  assert.ok(isAudioFile(new File(['x'], 'SONG.M4A')));
  assert.equal(isAudioFile(new File([], 'empty.mp3', { type: 'audio/mpeg' })), false);
  assert.equal(isAudioFile(new File(['x'], 'photo.png', { type: 'image/png' })), false);
  assert.equal(isAudioFile(new File(['x'], 'notes.txt')), false);
});
test('local files are bounded, deduplicated and all owned URLs are released without touching built-ins', () => {
  const created: string[] = [], revoked: string[] = [];
  const library = new MusicLibrary({ create: () => { const url = `blob:test-${created.length}`; created.push(url); return url; }, revoke: url => revoked.push(url) });
  const file = new File(['music'], '<script>.mp3', { type: 'audio/mpeg', lastModified: 10 });
  const added = library.add([file, file, new File(['x'], 'bad.txt')]);
  assert.equal(added.firstId, 'local-1'); assert.equal(added.duplicates, 1); assert.equal(added.rejected, 1);
  assert.equal(library.tracks.at(-1)!.title, '<script>.mp3');
  library.add(Array.from({length: 30}, (_,i) => new File(['x'], `song-${i}.wav`, { type: 'audio/wav' })));
  assert.equal(library.localCount, MAX_LOCAL_TRACKS); assert.equal(created.length, MAX_LOCAL_TRACKS);
  library.clearLocal(); assert.deepEqual(revoked, created); assert.equal(library.localCount, 0); assert.deepEqual(library.tracks, BUILTIN_MUSIC);
  library.clearLocal(); assert.equal(revoked.length, MAX_LOCAL_TRACKS);
});
test('playback starts on request, remembers volume, and advances only on a natural ending', async () => {
  let next = 0; const { audio, player } = setup(() => next++);
  assert.equal(player.phase, 'paused'); assert.equal(audio.preload, 'none');
  player.setVolume(42); await player.play(); assert.equal(player.phase, 'playing'); assert.equal(audio.volume, .42);
  audio.emit('ended'); assert.equal(next, 1);
  player.pause(); audio.emit('ended'); assert.equal(next, 1); player.dispose();
});
test('a delayed play cannot restart audio after stopping or overwrite a newer selected song', async () => {
  const { audio, player } = setup(); const first = deferred(); audio.operation = () => first.promise;
  const pending = player.play(); player.pause(); first.resolve(); await pending;
  assert.equal(audio.paused, true); assert.equal(player.phase, 'paused');
  const old = deferred(); audio.operation = () => old.promise; const older = player.play();
  audio.operation = async () => {}; player.select(BUILTIN_MUSIC[1], true);
  await Promise.resolve(); old.reject(new Error('Old track aborted')); await older;
  assert.equal(player.track.id, BUILTIN_MUSIC[1].id); assert.equal(player.phase, 'playing'); assert.equal(audio.paused, false); player.dispose();
});
test('autoplay rejection and decoding failure remain recoverable and reports contain no filenames or URLs', async () => {
  const { audio, player, events } = setup();
  audio.operation = async () => { throw new DOMException('Playback blocked', 'NotAllowedError'); };
  await player.play(); assert.equal(player.phase, 'blocked');
  player.select({ id:'local-1', title:'private name.mp3', src:'blob:private-address', kind:'local' }, false);
  audio.operation = async () => {}; await player.play(); audio.emit('error'); assert.equal(player.phase, 'error');
  assert.equal(JSON.stringify(events).includes('private'), false);
  player.select(BUILTIN_MUSIC[0], true); await Promise.resolve(); assert.equal(player.phase, 'playing'); player.dispose();
});
test('round end fades, pauses, restores volume and prevents auto-advance', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); let now = 0; t.mock.method(performance, 'now', () => now);
  let next = 0; const { audio, player } = setup(() => next++); player.setVolume(40); await player.play();
  player.endRound(); now = 450; t.mock.timers.tick(60); assert.equal(audio.volume, .2);
  audio.emit('ended'); assert.equal(next, 0);
  now = 900; t.mock.timers.tick(60); assert.equal(audio.paused, true); assert.equal(audio.volume, .4); player.dispose();
});
test('manual play during a previous round fade cancels the old pause', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); let now = 0; t.mock.method(performance, 'now', () => now);
  const { audio, player } = setup(); await player.play(); player.endRound();
  now = 450; t.mock.timers.tick(60); await player.play(); now = 1200; t.mock.timers.tick(1200);
  assert.equal(audio.paused, false); assert.equal(player.phase, 'playing'); assert.equal(audio.volume, .35); player.dispose();
});
test('pending load at round end stays paused and disposal releases its source', async () => {
  const { audio, player } = setup(); const wait = deferred(); audio.operation = () => wait.promise;
  const pending = player.play(); player.endRound(); wait.resolve(); await pending;
  assert.equal(audio.paused, true); player.dispose(); assert.equal(audio.src, '');
});
test('playlist navigation wraps in either direction and empty lists are safe', () => {
  assert.equal(nextMusicIndex(2,3,1),0); assert.equal(nextMusicIndex(0,3,-1),2); assert.equal(nextMusicIndex(0,0,1),0);
});
