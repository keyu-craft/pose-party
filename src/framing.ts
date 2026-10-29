import { POSES } from './poses.ts';
import type { Point } from './poses.ts';

export type FramingIssue = 'framing-step-back' | 'framing-center' | 'framing-shoulders';
// Estimate room for this game's arm targets from shoulder width and available
// visible limb lengths. This is a standing-position aid, not an unseen-hand pose.
export function framingIssue(body: readonly Point[], width: number, height: number): FramingIssue | null {
  const usable = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= .65 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !usable(body[11]) || !usable(body[12])) return 'framing-shoulders';
  const point = (p: Point) => ({ x: (1 - p.x) * width, y: p.y * height });
  const left = point(body[11]), right = point(body[12]);
  const span = Math.hypot(right.x - left.x, right.y - left.y);
  if (span < width * .06) return 'framing-shoulders';
  const roll = Math.atan2(right.y - left.y, right.x - left.x);
  const segments = [[11,13], [13,15], [12,14], [14,16]];
  const lengths = segments.map(([a,b]) => usable(body[a]) && usable(body[b])
    ? Math.max(span * .8, Math.min(span * 1.1, Math.hypot((body[a].x - body[b].x) * width, (body[a].y - body[b].y) * height))) : span * .8);
  const points = [left, right];
  for (const pose of POSES) {
    for (const [side, origin] of [left, right].entries()) {
      let current = origin;
      for (let segment = side * 2; segment < side * 2 + 2; segment++) {
        const angle = pose.angles[segment] * Math.PI / 180 + roll;
        current = { x: current.x + Math.cos(angle) * lengths[segment], y: current.y + Math.sin(angle) * lengths[segment] }; points.push(current);
      }
    }
  }
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const marginX = width * .025, marginY = height * .025;
  if (maxX - minX > width - 2 * marginX || maxY - minY > height - 2 * marginY) return 'framing-step-back';
  // Close players usually lose vertical headroom before their full span stops
  // fitting. Reducing scale helps; sideways offsets need a centering prompt.
  if (minY < marginY || maxY > height - marginY) return 'framing-step-back';
  if (minX < marginX || maxX > width - marginX) return 'framing-center';
  return null;
}
