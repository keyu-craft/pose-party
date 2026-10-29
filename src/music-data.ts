import type { CopyKey } from './i18n.ts';
export interface MusicTrack {
  id: string; title: string; src: string; kind: 'builtin' | 'local';
  style?: CopyKey; artist?: string; source?: string;
}
export const BUILTIN_MUSIC: readonly MusicTrack[] = [
  { id: 'disco', title: 'Disco Medusae', src: '/music/disco-medusae.mp3', kind: 'builtin', style: 'musicDisco', artist: 'Kevin MacLeod', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500041' },
  { id: 'electro', title: 'Cipher', src: '/music/cipher.mp3', kind: 'builtin', style: 'musicElectro', artist: 'Kevin MacLeod', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844' },
  { id: 'funk', title: 'Cold Funk', src: '/music/cold-funk.mp3', kind: 'builtin', style: 'musicFunk', artist: 'Kevin MacLeod', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100499' },
];
export const nextMusicIndex = (index: number, length: number, direction: 1 | -1) => length > 0 ? (index + direction + length) % length : 0;
export const MAX_LOCAL_TRACKS = 20;
export function isAudioFile(file: Pick<File, 'name' | 'type' | 'size'>): boolean {
  if (file.size <= 0) return false;
  return file.type.startsWith('audio/') || ((!file.type || file.type === 'application/octet-stream') && /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(file.name));
}
// File names and URLs stay in memory. Revoke only URLs owned by this library.
export class MusicLibrary {
  private local: { track: MusicTrack; key: string }[] = [];
  private serial = 0;
  private readonly urls: { create(file: File): string; revoke(url: string): void };
  constructor(urls = { create: (file: File) => URL.createObjectURL(file), revoke: (url: string) => URL.revokeObjectURL(url) }) { this.urls = urls; }
  get tracks(): readonly MusicTrack[] { return [...BUILTIN_MUSIC, ...this.local.map(item => item.track)]; }
  get localCount() { return this.local.length; }
  add(files: readonly File[]) {
    let firstId: string | null = null, rejected = 0, duplicates = 0;
    for (const file of files) {
      if (!isAudioFile(file)) { rejected++; continue; }
      const key = JSON.stringify([file.name, file.size, file.lastModified]);
      if (this.local.some(item => item.key === key)) { duplicates++; continue; }
      if (this.local.length >= MAX_LOCAL_TRACKS) { rejected++; continue; }
      try {
        const track: MusicTrack = { id: `local-${++this.serial}`, title: file.name, src: this.urls.create(file), kind: 'local' };
        this.local.push({ track, key }); firstId ??= track.id;
      } catch { rejected++; }
    }
    return { firstId, rejected, duplicates };
  }
  clearLocal() { for (const item of this.local) this.urls.revoke(item.track.src); this.local = []; }
}
