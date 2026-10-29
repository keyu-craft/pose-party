import type { Point } from './poses.ts';
import type { FaceMatrix } from './readiness.ts';
import type { PoseLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
import { publicAsset } from './public-assets.ts';

const MODELS = {
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};
export interface InitResult {
  backend: 'worker' | 'main-fallback'; poseDelegate: 'GPU' | 'CPU'; faceDelegate: 'GPU' | 'CPU';
  stages: { stage: string; offsetMs: number; durationMs: number; ok: boolean }[]; workerFailure?: string;
}
export interface Detection { body: Point[]; face: Point[]; matrix?: FaceMatrix; poseMs: number; faceMs: number | null }

// One outstanding request, no frame queue. Responses are rejected on shutdown.
export class InferenceClient {
  backend: InitResult['backend'] = 'worker';
  private worker: Worker | null = null;
  private body: PoseLandmarker | null = null;
  private face: FaceLandmarker | null = null;
  private closed = false;
  private busy = false;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  async initialize(): Promise<InitResult> {
    const initializationStarted = performance.now();
    let workerFailure = 'WorkerUnsupported';
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        this.worker = new Worker(publicAsset('inference-worker.js'));
        this.worker.onmessage = event => {
          const pending = this.pending.get(event.data.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(event.data.id);
          if (event.data.ok) pending.resolve(event.data.result); else pending.reject(new Error(event.data.code ?? 'WorkerError'));
        };
        this.worker.onerror = () => this.rejectPending(new Error('WorkerError'));
        return await this.request<InitResult>({ type: 'init', models: MODELS }, [], 45_000);
      } catch (error) {
        if (this.closed) throw error;
        workerFailure = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.message) ? error.message : 'WorkerInitError';
        this.worker?.terminate(); this.worker = null;
      }
    }
    this.backend = 'main-fallback';
    const offset = performance.now() - initializationStarted;
    const result = await this.initializeMain();
    return { ...result, stages: result.stages.map(s => ({ ...s, offsetMs: s.offsetMs + offset })), workerFailure };
  }
  private request<T>(data: Record<string, unknown>, transfer: Transferable[], timeout: number): Promise<T> {
    if (!this.worker || this.closed) return Promise.reject(new Error('DetectorClosed'));
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('WorkerTimeout')); }, timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker!.postMessage({ ...data, id }, transfer); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private rejectPending(error: Error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  private async initializeMain(): Promise<InitResult> {
    const stages: InitResult['stages'] = [], origin = performance.now();
    const measure = async <T>(stage: string, operation: () => Promise<T>) => {
      const at = performance.now();
      try { const value = await operation(); stages.push({ stage, offsetMs: at - origin, durationMs: performance.now() - at, ok: true }); return value; }
      catch (error) { stages.push({ stage, offsetMs: at - origin, durationMs: performance.now() - at, ok: false }); throw error; }
    };
    const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision');
    if (this.closed) throw new Error('DetectorClosed');
    const vision = await FilesetResolver.forVisionTasks(publicAsset('mediapipe/wasm'));
    let poseDelegate: 'GPU' | 'CPU' = 'GPU', faceDelegate: 'GPU' | 'CPU' = 'GPU';
    try { this.body = await measure('pose-gpu', () => PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODELS.pose, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6 })); }
    catch (error) { if (this.closed) throw error; poseDelegate = 'CPU'; this.body = await measure('pose-cpu', () => PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODELS.pose, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6 })); }
    if (this.closed) { this.body.close(); this.body = null; throw new Error('DetectorClosed'); }
    try { this.face = await measure('face-gpu', () => FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODELS.face, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true })); }
    catch (error) { if (this.closed) throw error; faceDelegate = 'CPU'; this.face = await measure('face-cpu', () => FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODELS.face, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true })); }
    if (this.closed) { this.face.close(); this.face = null; throw new Error('DetectorClosed'); }
    return { backend: 'main-fallback', poseDelegate, faceDelegate, stages };
  }
  async infer(bitmap: ImageBitmap, timestamp: number, needsFace: boolean): Promise<Detection> {
    if (this.closed || this.busy) { bitmap.close(); throw new Error(this.closed ? 'DetectorClosed' : 'DetectorBusy'); }
    this.busy = true;
    try {
      if (this.worker) return await this.request<Detection>({ type: 'infer', bitmap, timestamp, needsFace }, [bitmap], 10_000);
      if (!this.body || !this.face) throw new Error('NotInitialized');
      const at = performance.now(), body = this.body.detectForVideo(bitmap, timestamp).landmarks[0] ?? [];
      const poseMs = performance.now() - at;
      let face: Point[] = [], matrix: FaceMatrix | undefined, faceMs: number | null = null;
      if (needsFace) {
        // Same captured image, separated tasks: the fallback can paint between models.
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 40);
          requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); resolve(); }, 0));
        });
        if (this.closed) throw new Error('DetectorClosed');
        const start = performance.now(), result = this.face.detectForVideo(bitmap, timestamp);
        faceMs = performance.now() - start; face = result.faceLandmarks[0] ?? []; matrix = result.facialTransformationMatrixes[0];
      }
      return { body, face, matrix, poseMs, faceMs };
    } finally { bitmap.close(); this.busy = false; }
  }
  close() {
    this.closed = true; this.rejectPending(new Error('DetectorClosed'));
    this.worker?.terminate(); this.worker = null; this.body?.close(); this.body = null; this.face?.close(); this.face = null;
  }
}
