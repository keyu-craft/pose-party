/* Classic worker: the official pinned CJS bundle uses importScripts for WASM.
   No user frames leave this worker/page. ImageBitmaps are closed after each job. */
(() => {
  let bodyTask = null, faceTask = null;
  const safeCode = error => /^[A-Za-z]{1,40}$/.test(error?.name ?? '') ? error.name : 'Error';
  self.onmessage = async event => {
    const { id, type } = event.data;
    let bitmap;
    try {
      if (type === 'init') {
        self.exports = {};
        importScripts(new URL('mediapipe/vision.cjs.js', self.location.href).href);
        const tasks = self.exports;
        const origin = performance.now(), stages = [];
        const measure = async (stage, operation) => {
          const at = performance.now();
          try { const result = await operation(); stages.push({ stage, offsetMs: at - origin, durationMs: performance.now() - at, ok: true }); return result; }
          catch (error) { stages.push({ stage, offsetMs: at - origin, durationMs: performance.now() - at, ok: false }); throw error; }
        };
        const vision = await measure('wasm-resolve', () => tasks.FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', self.location.href).href));
        const create = async (kind, Factory, options) => {
          for (const delegate of ['GPU', 'CPU']) {
            try {
              const task = await measure(`${kind}-${delegate.toLowerCase()}`, () => Factory.createFromOptions(vision, {
                ...options, canvas: new OffscreenCanvas(1, 1), baseOptions: { modelAssetPath: event.data.models[kind], delegate }, runningMode: 'VIDEO',
              }));
              return { task, delegate };
            } catch (error) { if (delegate === 'CPU') throw error; }
          }
        };
        const body = await create('pose', tasks.PoseLandmarker, { numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6 });
        bodyTask = body.task;
        const face = await create('face', tasks.FaceLandmarker, { numFaces: 1, outputFacialTransformationMatrixes: true, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceTask = face.task;
        self.postMessage({ id, ok: true, result: { backend: 'worker', poseDelegate: body.delegate, faceDelegate: face.delegate, stages } });
      } else if (type === 'infer') {
        bitmap = event.data.bitmap;
        if (!bodyTask || !faceTask) throw new Error('NotInitialized');
        let at = performance.now();
        const body = bodyTask.detectForVideo(bitmap, event.data.timestamp).landmarks[0] ?? [];
        const poseMs = performance.now() - at;
        let face = [], matrix, faceMs = null;
        if (event.data.needsFace) {
          at = performance.now();
          const result = faceTask.detectForVideo(bitmap, event.data.timestamp);
          faceMs = performance.now() - at; face = result.faceLandmarks[0] ?? []; matrix = result.facialTransformationMatrixes[0];
        }
        self.postMessage({ id, ok: true, result: { body, face, matrix, poseMs, faceMs } });
      }
    } catch (error) {
      console.error('Inference worker:', error);
      self.postMessage({ id, ok: false, code: safeCode(error) });
    } finally { bitmap?.close(); }
  };
})();
