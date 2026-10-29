import type { Point } from './poses.ts';

export const FACE_LIMITS = { maxTiltDegrees: 35, minEyeSpan: 0.025 };
export interface FaceMatrix { rows: number; columns: number; data: readonly number[] }

// This is broad head orientation, not eye-gaze tracking. Rotation about the
// camera-facing axis (head roll) is allowed; turning/tilting away is limited.
export function facePlayerIssue(face: readonly Point[], body: readonly Point[], width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return 'invalid-frame-size';
  if (!face.length) return 'face-missing';
  const nose = face[1], leftEye = face[33], rightEye = face[263];
  const bodyNose = body[0], leftShoulder = body[11], rightShoulder = body[12];
  if ([nose, leftEye, rightEye, bodyNose, leftShoulder, rightShoulder].some(p =>
    !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'face-landmarks-missing';
  if ([nose, leftEye, rightEye].some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return 'face-out-of-frame';
  if ([bodyNose, leftShoulder, rightShoulder].some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return 'face-body-mismatch';
  if ((leftShoulder.visibility ?? 0) < 0.5) return 'left-shoulder-low-confidence';
  if ((rightShoulder.visibility ?? 0) < 0.5) return 'right-shoulder-low-confidence';
  if (Math.abs(leftEye.x - rightEye.x) < FACE_LIMITS.minEyeSpan) return 'face-too-small';
  const shoulders = Math.hypot((leftShoulder.x - rightShoulder.x) * width, (leftShoulder.y - rightShoulder.y) * height);
  const noseDistance = Math.hypot((nose.x - bodyNose.x) * width, (nose.y - bodyNose.y) * height);
  if (noseDistance > Math.max(width * 0.03, shoulders * 0.65)) return 'face-body-mismatch';
  return null;
}
export function faceBelongsToPlayer(face: readonly Point[], body: readonly Point[], width: number, height: number): boolean {
  return facePlayerIssue(face, body, width, height) === null;
}
export function facingIssue(face: readonly Point[], matrix: FaceMatrix | undefined, body: readonly Point[], width: number, height: number): string | null {
  const issue = facePlayerIssue(face, body, width, height);
  if (issue) return issue;
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16 || matrix.data.some(n => !Number.isFinite(n))) return 'face-matrix-missing';
  const m = matrix.data, axisLength = Math.hypot(m[8], m[9], m[10]);
  return axisLength > 0 && m[10] / axisLength >= Math.cos(FACE_LIMITS.maxTiltDegrees * Math.PI / 180) ? null : 'face-not-frontal';
}
export function isFacingScreen(face: readonly Point[], matrix: FaceMatrix | undefined, body: readonly Point[], width: number, height: number): boolean {
  return facingIssue(face, matrix, body, width, height) === null;
}
