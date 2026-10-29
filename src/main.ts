import './style.css';
import { choosePose } from './poses.ts';
import type { Point } from './poses.ts';
import { PoseMatcher } from './matching.ts';
import { drawSkeleton, drawTarget } from './draw.ts';
import { RoundEngine, TIMING, targetMode, formatTime } from './game.ts';
import type { RoundState } from './game.ts';
import { facingIssue } from './readiness.ts';
import { framingIssue } from './framing.ts';
import { uncertaintyGrace } from './tracking-policy.ts';
import { InferenceClient } from './inference-client.ts';
import { acceptsFrame, frameStage, INFERENCE_POLICY } from './inference-policy.ts';
import type { FrameTicket } from './inference-policy.ts';
import { COPY } from './i18n.ts';
import type { Language, CopyKey } from './i18n.ts';
import { PerformanceTools } from './performance-panel.ts';
import { MusicTools } from './music.ts';
import type { ProfileMode, RunOutcome } from './diagnostics.ts';

let language: Language = 'en';
try { if (localStorage.getItem('pose-party-language') === 'zh') language = 'zh'; } catch { /* Optional storage. */ }
const text = (key: CopyKey) => COPY[language][key];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="./"><span aria-hidden="true">✳</span> pose party<span class="brand-dot">.</span></a>
      <div class="header-actions">
        <div class="session-clock" id="session-clock" role="timer"><span id="clock">01:00</span></div>
        <div class="score"><strong id="score">0</strong><span id="score-label"></span></div>
        <button class="language" id="language">中文</button>
        <button class="icon-button music-toggle" id="music-toggle" aria-expanded="false"><span aria-hidden="true">♫</span></button>
        <button class="icon-button" id="sound" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14"/></svg><span class="mute-slash" aria-hidden="true"></span></button>
        <button class="icon-button" id="fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
      </div>
    </header>
    <div class="play-layout" id="play-layout"><section class="stage" id="stage">
      <aside class="target-panel">
        <div class="target-heading"><span class="phase-dot"></span><span id="phase-label"></span></div>
        <div class="figure" id="figure">
          <div class="ready-ring" id="ready-ring" aria-hidden="true" hidden><svg viewBox="0 0 100 100"><circle class="ring-track" cx="50" cy="50" r="46"/><circle id="ready-fill" cx="50" cy="50" r="46" pathLength="100"/></svg></div>
          <canvas id="target" width="440" height="400" role="img"></canvas>
        </div>
        <div class="timer"><strong id="time">1</strong><span id="time-unit">s</span></div>
        <div class="progress" id="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progress-fill"></div></div>
      </aside>
      <div class="camera-frame" id="camera-frame">
        <video id="video" autoplay muted playsinline></video>
        <canvas id="overlay" aria-hidden="true"></canvas>
        <div class="camera-label"><i id="camera-dot"></i><span id="camera-label"></span></div>
        <div class="empty-state" id="empty-state"><span class="empty-icon" aria-hidden="true">↗</span><p id="empty-copy"></p></div>
        <div class="signal" id="signal" hidden><span class="signal-title" id="signal-title" hidden></span><span id="signal-symbol" aria-hidden="true"></span><span id="signal-copy"></span></div>
        <div class="tracking-note" id="tracking-note" hidden></div>
      </div>
    </section><aside class="music-panel" id="music-panel" hidden></aside></div>
    <footer><div class="footer-copy"><p id="status" role="status" aria-live="polite"></p><span id="rule"></span></div><div class="footer-actions"><button class="report-button" id="performance"></button><button class="primary" id="start"></button></div></footer>
  </main>`;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = el<HTMLVideoElement>('video');
const target = el<HTMLCanvasElement>('target');
const overlay = el<HTMLCanvasElement>('overlay');
const start = el<HTMLButtonElement>('start');
const profiling = new PerformanceTools(video, () => language, el<HTMLButtonElement>('performance'));
const music = new MusicTools(el('music-panel'), el<HTMLButtonElement>('music-toggle'), el('play-layout'), () => language, code => profiling.event('background-music', code));
el('performance').addEventListener('click', () => music.pause());
const engine = new RoundEngine();
const matcher = new PoseMatcher();
let state: RoundState = engine.reset();
let pose = choosePose();
const neutral = { id: 'neutral', description: { en: 'Ready', zh: '准备' }, angles: [90, 90, 90, 90] as const };
let detector: InferenceClient | null = null;
let inFlight = false, captureRevision = 0;
let trackingReasons: string[] = [];
let stream: MediaStream | null = null;
let running = false, loading = false;
let generation = 0, frame = 0;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
let previousVideoTime = -1, lastInference = -Infinity;
let statusKey: CopyKey = 'empty';
let soundOn = true;
let audio: AudioContext | null = null;

function setStatus(key: CopyKey) { statusKey = key; el('status').textContent = text(key); }
function sound(kind: 'start' | 'pass' | 'end') {
  if (!soundOn || !audio || audio.state !== 'running') return;
  const ctx = audio;
  const notes = kind === 'pass' ? [660, 880] : kind === 'start' ? [440, 660] : [660, 440, 330];
  notes.forEach((frequency, i) => {
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + i * 0.14;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.1, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(at); oscillator.stop(at + 0.13);
  });
}
function unlockAudio() {
  if (!soundOn) return;
  try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { /* Optional sound. */ }
}
function phaseKey(): CopyKey {
  return state.phase === 'finished' ? 'finished' : !running ? 'ready' : state.phase === 'match' ? 'match' : state.phase === 'hold' ? 'hold' : state.phase === 'success' ? 'success' : 'ready';
}
function paint() {
  const paintStarted = performance.now();
  const finished = state.phase === 'finished';
  el('stage').dataset.phase = finished ? 'finished' : running ? state.phase : 'idle';
  el('phase-label').textContent = text(phaseKey());
  el('score').textContent = String(state.score);
  el('clock').textContent = formatTime(state.remainingMs);
  el('session-clock').classList.toggle('urgent', state.remainingMs <= 10_000 && !finished);
  el('time').textContent = String(TIMING.holdMs / 1000);
  const active = targetMode(state, running) === 'pose';
  for (const node of [document.querySelector<HTMLElement>('.timer')!, el('progress')]) {
    node.style.visibility = active ? 'visible' : 'hidden'; node.setAttribute('aria-hidden', String(!active));
  }
  el('progress-fill').style.width = `${state.progress * 100}%`;
  el('progress').setAttribute('aria-valuenow', String(Math.round(state.progress * 100)));
  el('ready-ring').hidden = !(running && state.phase === 'ready');
  el('ready-fill').style.strokeDashoffset = String(100 - state.readyProgress * 100);
  const result = finished || (running && state.phase === 'success');
  el('signal').hidden = !result;
  el('signal-title').hidden = !finished;
  el('signal-title').textContent = text('finished');
  el('signal-symbol').textContent = finished ? String(state.score) : '✓';
  el('signal-copy').textContent = text(finished ? 'finalScore' : 'success');
  const preparing = running && state.phase === 'ready';
  el('tracking-note').hidden = !(preparing || (running && active && !state.tracking));
  const framingKey = trackingReasons.includes('framing-step-back') ? 'stepBack' : trackingReasons.includes('framing-center') ? 'centerFrame' : trackingReasons.includes('framing-shoulders') ? 'showShoulders' : null;
  const outOfFrame = trackingReasons.some(r => /^(left|right)-(shoulder|elbow|wrist)-out-of-frame$/.test(r));
  el('tracking-note').textContent = text(preparing ? framingKey ?? 'faceScreen' : outOfFrame ? 'handsOut' : trackingReasons.some(r => r.includes('wrist-')) ? 'wristsVisible' : pose.headTilt !== undefined ? 'headVisible' : 'waiting');
  el('camera-frame').classList.toggle('needs-space', running && (preparing || active) && (framingKey !== null || outOfFrame));
  el('status').hidden = !loading && (running || statusKey === 'empty' || finished);
  start.textContent = text(loading ? 'cancel' : running ? 'stop' : finished ? 'again' : 'start');
  profiling.ui(performance.now() - paintStarted);
}
function paintTarget() {
  const paintStarted = performance.now();
  const mode = targetMode(state, running), shown = mode === 'pose' ? pose : neutral;
  el('figure').dataset.mode = mode; drawTarget(target, shown);
  target.setAttribute('aria-label', `${text('target')}: ${shown.description[language]}`);
  profiling.ui(performance.now() - paintStarted);
}
function translate() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'Pose Party' : 'Pose Party · 姿势模仿';
  document.querySelector('.brand')!.setAttribute('aria-label', text('home'));
  el('stage').setAttribute('aria-label', text('game'));
  el('language').textContent = language === 'en' ? '中文' : 'EN';
  el('language').setAttribute('aria-label', text('language'));
  el('score-label').textContent = text('score'); el('time-unit').textContent = text('seconds');
  el('session-clock').setAttribute('aria-label', text('sessionTime'));
  el('camera-label').textContent = text(stream ? 'cameraOn' : 'cameraOff');
  video.setAttribute('aria-label', text('preview'));
  el('empty-copy').textContent = text('empty'); el('rule').textContent = text('idle');
  el('status').textContent = text(statusKey);
  el('progress').setAttribute('aria-label', text('progress'));
  document.querySelector('.timer')!.setAttribute('aria-label', text('timer'));
  for (const [id, key] of [['fullscreen', document.fullscreenElement ? 'exitFullscreen' : 'fullscreen'], ['sound', soundOn ? 'soundOn' : 'soundOff']] as const) {
    el(id).setAttribute('aria-label', text(key)); el(id).title = text(key);
  }
  paint(); paintTarget(); profiling.translate(); music.translate();
}
translate();

function releaseCamera(outcome: Exclude<RunOutcome, 'active'>) {
  profiling.stop(outcome);
  matcher.reset();
  generation++; running = false; loading = false; cancelAnimationFrame(frame); clearTimeout(deadlineTimer);
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
  video.srcObject = null; detector?.close(); detector = null; inFlight = false; captureRevision++; trackingReasons = [];
  overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  el('empty-state').hidden = false; el('camera-dot').classList.remove('live'); el('camera-frame').classList.remove('is-live');
}
function stopCamera(key: CopyKey = 'empty') {
  music.pause();
  releaseCamera(key !== 'empty' ? 'error' : loading ? 'cancelled' : 'stopped'); state = engine.reset(); setStatus(key); translate();
}
function finishGame() {
  music.endRound();
  sound('end'); releaseCamera('finished'); setStatus('finished'); translate();
}
function scheduleDeadline() {
  clearTimeout(deadlineTimer);
  deadlineTimer = setTimeout(() => {
    if (!running) return;
    state = engine.clock(performance.now());
    if (state.phase === 'finished') finishGame(); else scheduleDeadline();
  }, state.remainingMs + 1);
}

async function startCamera() {
  if (running || loading) { stopCamera(); return; }
  unlockAudio();
  const request = ++generation, profileRun = profiling.start();
  profileRun.metadata('optimizationVersion', 'framing-edge-v2');
  profileRun.metadata('backgroundMusic', music.profileStatus);
  loading = true; setStatus('loadingModel'); paint();
  const pending = new InferenceClient(); detector = pending;
  let pendingStream: MediaStream | null = null;
  const current = () => request === generation && detector === pending;
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof createImageBitmap !== 'function') throw new Error('CAMERA_UNAVAILABLE');
    const initStarted = performance.now();
    const initialized = await profiling.time(profileRun, 'inference-init', () => pending.initialize());
    if (!current()) { pending.close(); return; }
    for (const stage of initialized.stages) profileRun.stage(stage.stage, initStarted + stage.offsetMs, initStarted + stage.offsetMs + stage.durationMs, stage.ok);
    profileRun.delegate('pose', initialized.poseDelegate); profileRun.delegate('face', initialized.faceDelegate);
    profileRun.metadata('inferenceExecution', initialized.backend);
    profileRun.event('execution-mode', performance.now(), undefined, initialized.backend);
    if (initialized.workerFailure) profileRun.event('worker-fallback', performance.now(), undefined, initialized.workerFailure);
    setStatus('permission');
    pendingStream = await profiling.time(profileRun, 'camera-access', () => navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } }));
    if (!current()) { pendingStream.getTracks().forEach(t => t.stop()); pending.close(); return; }
    video.srcObject = pendingStream; await profiling.time(profileRun, 'video-start', () => video.play());
    if (!current()) { pendingStream.getTracks().forEach(t => t.stop()); pending.close(); return; }
    stream = pendingStream;
    for (const track of stream.getVideoTracks()) track.onended = () => stopCamera('disconnected');
    overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    profiling.cameraReady();
    el('empty-state').hidden = true; el('camera-dot').classList.add('live'); el('camera-frame').classList.add('is-live');
    setStatus('warmingUp'); translate();
    // Real camera frames warm up detector/landmark graphs before readiness can
    // start the minute. Warm-up outputs never enter matching or scoring.
    for (let i = 0; i < INFERENCE_POLICY.warmupFrames; i++) {
      await new Promise(resolve => setTimeout(resolve, 80));
      if (!current()) return;
      const bitmap = await createImageBitmap(video), timestamp = performance.now();
      if (!current()) { bitmap.close(); return; }
      const result = await pending.infer(bitmap, timestamp, true);
      if (!current()) return;
      const end = performance.now();
      profileRun.stage(`warmup-pose-${i + 1}`, end - (result.faceMs ?? 0) - result.poseMs, end - (result.faceMs ?? 0), true);
      profileRun.stage(`warmup-face-${i + 1}`, end - (result.faceMs ?? 0), end, true);
      profileRun.event('warmup-detection', end, undefined, result.body.length && result.face.length ? 'body-and-face' : result.body.length ? 'body-only' : 'none');
    }
    running = true; loading = false; inFlight = false; captureRevision++; trackingReasons = [];
    previousVideoTime = -1; lastInference = -Infinity; state = engine.reset(); matcher.reset();
    updateProfileContext(performance.now()); setStatus('faceScreen'); translate(); frame = requestAnimationFrame(tick);
  } catch (error) {
    if (!current()) return;
    if (pendingStream && pendingStream !== stream) pendingStream.getTracks().forEach(track => track.stop());
    const name = error instanceof Error ? error.name : '';
    const key: CopyKey = name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'missing' : name === 'NotReadableError' ? 'busy' : error instanceof Error && error.message === 'CAMERA_UNAVAILABLE' ? 'unavailable' : 'error';
    profiling.event('startup-error', /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error');
    console.error('Pose Party startup failed:', error); stopCamera(key);
  }
}

function resetTracking() {
  profiling.visibility(); captureRevision++; trackingReasons = [];
  matcher.reset(); state = engine.interrupt(performance.now());
  if (!running) return;
  if (state.phase === 'finished') { finishGame(); return; }
  setStatus(state.phase === 'ready' ? 'faceScreen' : 'waiting'); paint(); paintTarget();
}
function updateProfileContext(now: number) {
  const active = state.phase === 'match' || state.phase === 'hold';
  const mode: ProfileMode = state.phase === 'ready' ? 'ready' : active ? pose.headTilt === undefined ? 'arms' : 'head' : 'transition';
  profiling.context({ mode, phase: state.phase, poseId: active ? pose.id : null, roundId: state.roundId }, now);
}
function tick() {
  if (!running || !detector) return;
  const now = performance.now();
  state = engine.clock(now);
  if (state.phase === 'finished') { finishGame(); return; }
  updateProfileContext(now); profiling.frame(now); paint();
  if (document.hidden || video.readyState < 2) { resetTracking(); frame = requestAnimationFrame(tick); return; }
  const needsHead = pose.headTilt !== undefined && (state.phase === 'match' || state.phase === 'hold');
  const needsFace = state.phase === 'ready' || needsHead;
  const interval = needsFace ? INFERENCE_POLICY.headIntervalMs : INFERENCE_POLICY.bodyIntervalMs;
  if (!inFlight && now - lastInference >= interval && video.currentTime !== previousVideoTime) {
    inFlight = true; lastInference = now; previousVideoTime = video.currentTime;
    const ticket: FrameTicket = { generation, revision: captureRevision, roundId: state.roundId, stage: frameStage(state.phase), capturedAt: now };
    void processFrame(ticket, detector, needsHead, needsFace);
  } else if (!inFlight && now - lastInference > 250) resetTracking();
  frame = requestAnimationFrame(tick);
}
async function processFrame(ticket: FrameTicket, source: InferenceClient, needsHead: boolean, needsFace: boolean) {
  try {
    const bitmap = await createImageBitmap(video), captureMs = performance.now() - ticket.capturedAt;
    if (ticket.generation !== generation || source !== detector) { bitmap.close(); return; }
    const sentAt = performance.now();
    const result = await source.infer(bitmap, ticket.capturedAt, needsFace);
    if (ticket.generation !== generation || source !== detector || !running) return;
    const now = performance.now(), roundTripMs = now - sentAt;
    state = engine.clock(now);
    if (state.phase === 'finished') { finishGame(); return; }
    if (!acceptsFrame(ticket, { generation, revision: captureRevision, roundId: state.roundId, stage: frameStage(state.phase), visible: !document.hidden, running }, now)) {
      profiling.event('discarded-result', 'stale-or-changed-context');
      if (ticket.revision === captureRevision && !document.hidden) {
        trackingReasons = ['stale-frame']; matcher.reset(); state = engine.interrupt(now);
        profiling.inference({ poseMs: result.poseMs, faceMs: result.faceMs, matchingMs: 0, drawingMs: 0, totalMs: now - ticket.capturedAt, captureMs, roundTripMs, valid: false, matched: false, reasons: trackingReasons });
      }
      return;
    }
    let face: readonly Point[] = [], faceProblem: string | null = null;
    if (needsFace) {
      faceProblem = facingIssue(result.face, result.matrix, result.body, video.videoWidth, video.videoHeight);
      if (!faceProblem) face = result.face;
    }
    let at = performance.now();
    const preparing = state.phase === 'ready';
    const frameProblem = preparing ? framingIssue(result.body, video.videoWidth, video.videoHeight) : null;
    const ready = faceProblem === null && frameProblem === null;
    const matched = matcher.update(result.body, face, pose, video.videoWidth, video.videoHeight, now, needsHead ? faceProblem ?? undefined : undefined);
    const matchingMs = performance.now() - at;
    trackingReasons = preparing ? [frameProblem, faceProblem].filter((reason): reason is string => reason !== null) : matched.reasons;
    at = performance.now(); drawSkeleton(overlay, result.body, !preparing && matched.armMatches, face, needsHead && matched.headMatches);
    const drawingMs = performance.now() - at, previous = state.phase, previousRound = state.roundId;
    state = engine.update(preparing ? ready : matched.valid, preparing ? ready : matched.matches, needsFace && ready, performance.now(), preparing ? false : matched.decisiveMismatch, uncertaintyGrace(trackingReasons));
    profiling.inference({ poseMs: result.poseMs, faceMs: result.faceMs, matchingMs, drawingMs, totalMs: performance.now() - ticket.capturedAt, captureMs, roundTripMs, valid: preparing ? ready : matched.valid, matched: preparing ? ready : matched.matches, reasons: trackingReasons });
    if (state.phase === 'finished') { finishGame(); return; }
    if (state.roundId !== previousRound) {
      pose = choosePose(pose.id); matcher.reset(); trackingReasons = [];
      if (previous === 'ready') { sound('start'); scheduleDeadline(); }
    }
    if (state.phase !== previous || state.roundId !== previousRound) {
      if (state.phase === 'success') sound('pass');
      setStatus(phaseKey()); paintTarget(); paint();
    }
    updateProfileContext(performance.now());
  } catch (error) {
    if (ticket.generation !== generation || source !== detector) return;
    if (ticket.revision !== captureRevision || document.hidden) { profiling.event('discarded-error', 'changed-context'); return; }
    profiling.event('inference-error', error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error');
    console.error('Pose inference failed:', error); stopCamera('inferenceError');
  } finally { if (ticket.generation === generation && source === detector) inFlight = false; }
}

start.addEventListener('click', () => void startCamera());
el('language').addEventListener('click', () => {
  language = language === 'en' ? 'zh' : 'en';
  try { localStorage.setItem('pose-party-language', language); } catch { /* Optional storage. */ }
  translate();
});
el('sound').addEventListener('click', () => {
  soundOn = !soundOn; el('sound').setAttribute('aria-pressed', String(soundOn));
  el('sound').classList.toggle('muted', !soundOn); unlockAudio(); translate();
});
el('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Normal view remains playable. */ }
});
document.addEventListener('fullscreenchange', translate);
document.addEventListener('visibilitychange', resetTracking);
window.addEventListener('pagehide', () => { profiling.stop('pagehide'); stopCamera(); });
if (import.meta.hot) import.meta.hot.dispose(() => { stopCamera(); profiling.dispose(); music.dispose(); void audio?.close(); });
