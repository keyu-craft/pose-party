import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'node_modules/@mediapipe/tasks-vision');
const packageInfo = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
if (packageInfo.version !== '0.10.32') throw new Error('The worker runtime must match @mediapipe/tasks-vision 0.10.32.');
const destination = resolve(root, 'public/mediapipe');
const names = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
try {
  if ((await readFile(resolve(destination, '.runtime-version'), 'utf8')) === packageInfo.version) {
    const pairs = [[resolve(source, 'vision_bundle.cjs'), resolve(destination, 'vision.cjs.js')], ...names.map(n => [resolve(source, 'wasm', n), resolve(destination, 'wasm', n)])];
    const matches = await Promise.all(pairs.map(async ([a, b]) => (await stat(a)).size === (await stat(b)).size));
    if (matches.every(Boolean)) process.exit(0);
  }
} catch { /* Missing or incomplete generated runtime: copy it below. */ }
await mkdir(resolve(destination, 'wasm'), { recursive: true });
await copyFile(resolve(source, 'vision_bundle.cjs'), resolve(destination, 'vision.cjs.js'));
for (const name of names) {
  await copyFile(resolve(source, 'wasm', name), resolve(destination, 'wasm', name));
}
await writeFile(resolve(destination, '.runtime-version'), packageInfo.version);
