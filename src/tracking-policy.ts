import type { Point } from './poses.ts';

export const TRACKING_TIMING = { uncertaintyMs: 150, edgeMs: 300 };
// An actual missing observation never earns hold time. Edge loss gets a little
// more recovery time; mixed failures retain the shorter uncertainty allowance.
export function uncertaintyGrace(reasons: readonly string[]): number {
  return reasons.some(r => /-(wrist|elbow)-out-of-frame$/.test(r)) &&
    reasons.every(r => /^(left|right)-(shoulder|elbow|wrist)-out-of-frame$/.test(r) || /^frame-(top|bottom|left|right)$/.test(r))
    ? TRACKING_TIMING.edgeMs : TRACKING_TIMING.uncertaintyMs;
}
export function outsideEdges(point: Point): string[] {
  const edges: string[] = [];
  if (point.x < 0) edges.push('frame-right');
  if (point.x > 1) edges.push('frame-left');
  if (point.y < 0) edges.push('frame-top');
  if (point.y > 1) edges.push('frame-bottom');
  return edges;
}
