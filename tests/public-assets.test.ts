import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAsset } from '../src/public-assets.ts';

test('worker, runtime, audio and credits stay under a GitHub Pages project path', () => {
  const page = 'https://example.github.io/pose-party/';
  for (const path of ['inference-worker.js', '/mediapipe/wasm', '/music/cipher.mp3', 'music/CREDITS.md']) {
    assert.equal(publicAsset(path, '/pose-party/', page), `https://example.github.io/pose-party/${path.replace(/^\/+/, '')}`);
  }
});
test('assets work at a root domain, an explicit index document and a relative base', () => {
  assert.equal(publicAsset('music/cipher.mp3','/','http://localhost:5173/'), 'http://localhost:5173/music/cipher.mp3');
  assert.equal(publicAsset('inference-worker.js','/renamed-game/','https://example.github.io/renamed-game/index.html'), 'https://example.github.io/renamed-game/inference-worker.js');
  assert.equal(publicAsset('inference-worker.js','./','https://example.github.io/pose-party/'), 'https://example.github.io/pose-party/inference-worker.js');
});
