import type { Point, Pose } from '../src/poses.ts';

export function observation(pose: Pose, width = 960, height = 720, scale = 1, offset = 0, bodyRoll = 0) {
  const body: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const face: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.3 }));
  const r = bodyRoll * Math.PI / 180;
  const origin = { x: width * (0.5 + offset), y: height * 0.5 };
  const rotate = (x: number, y: number) => ({ x: origin.x + x * Math.cos(r) - y * Math.sin(r), y: origin.y + x * Math.sin(r) + y * Math.cos(r) });
  const positions: Record<number, Point> = { 11: rotate(-width * 0.08 * scale, 0), 12: rotate(width * 0.08 * scale, 0) };
  for (const [i, [a, b]] of [[11, 13], [13, 15], [12, 14], [14, 16]].entries()) {
    const angle = (pose.angles[i] + bodyRoll) * Math.PI / 180;
    positions[b] = { x: positions[a].x + Math.cos(angle) * width * 0.08 * scale, y: positions[a].y + Math.sin(angle) * width * 0.08 * scale };
  }
  const normalized = (p: Point) => ({ x: 1 - p.x / width, y: p.y / height, visibility: 1 });
  for (const [i, p] of Object.entries(positions)) body[Number(i)] = normalized(p);
  const head = rotate(0, -width * 0.10 * scale);
  face[1] = body[0] = normalized(head);
  const angle = (bodyRoll + (pose.headTilt ?? 0)) * Math.PI / 180;
  const halfEyeWidth = width * 0.03 * scale;
  face[33] = normalized({ x: head.x - Math.cos(angle) * halfEyeWidth, y: head.y - Math.sin(angle) * halfEyeWidth });
  face[263] = normalized({ x: head.x + Math.cos(angle) * halfEyeWidth, y: head.y + Math.sin(angle) * halfEyeWidth });
  return { body, face };
}
