import { ARM_SEGMENTS } from './poses.ts';
import type { Point, Pose } from './poses.ts';

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function dot(ctx: CanvasRenderingContext2D, p: Point, radius: number) {
  ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
}

export function drawTarget(canvas: HTMLCanvasElement, pose: Pose) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const left = { x: 170, y: 195 }, right = { x: 270, y: 195 };
  const extend = (p: Point, deg: number, length: number) => ({
    x: p.x + Math.cos(deg * Math.PI / 180) * length,
    y: p.y + Math.sin(deg * Math.PI / 180) * length,
  });
  const elbowL = extend(left, pose.angles[0], 65);
  const handL = extend(elbowL, pose.angles[1], 60);
  const elbowR = extend(right, pose.angles[2], 65);
  const handR = extend(elbowR, pose.angles[3], 60);
  const hipL = { x: 188, y: 302 }, hipR = { x: 252, y: 302 };

  ctx.strokeStyle = '#d8d7d0'; ctx.lineWidth = 11;
  line(ctx, hipL, { x: 175, y: 370 }); line(ctx, hipR, { x: 265, y: 370 });
  ctx.strokeStyle = '#272a26'; ctx.lineWidth = 13;
  line(ctx, left, right); line(ctx, left, hipL); line(ctx, right, hipR); line(ctx, hipL, hipR);
  // Neck and facial features rotate together: a featureless circle cannot show roll.
  ctx.save(); ctx.translate(220, 190); ctx.rotate((pose.headTilt ?? 0) * Math.PI / 180);
  line(ctx, { x: 0, y: 0 }, { x: 0, y: -22 });
  ctx.fillStyle = pose.headTilt === undefined ? '#272a26' : '#ea6c46';
  dot(ctx, { x: 0, y: -50 }, 29);
  ctx.fillStyle = '#fffef9'; dot(ctx, { x: -10, y: -54 }, 3); dot(ctx, { x: 10, y: -54 }, 3);
  ctx.strokeStyle = '#fffef9'; ctx.lineWidth = 2.5;
  line(ctx, { x: 0, y: -48 }, { x: 2, y: -42 });
  ctx.restore();
  ctx.strokeStyle = '#ea6c46'; ctx.lineWidth = 13;
  line(ctx, left, elbowL); line(ctx, elbowL, handL); line(ctx, right, elbowR); line(ctx, elbowR, handR);
  ctx.fillStyle = '#f8c2a9';
  for (const p of [elbowL, elbowR]) dot(ctx, p, 7);
  ctx.fillStyle = '#ea6c46'; dot(ctx, handL, 9); dot(ctx, handR, 9);
}

export function drawSkeleton(canvas: HTMLCanvasElement, landmarks: readonly Point[], matching: boolean, face: readonly Point[] = [], headMatches = false) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = matching ? '#bcf38b' : '#ffd1a6';
  ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = Math.max(3, canvas.width / 180); ctx.lineCap = 'round';
  const point = (i: number) => ({ x: (1 - landmarks[i].x) * canvas.width, y: landmarks[i].y * canvas.height });
  const visible = (i: number) => landmarks[i] && (landmarks[i].visibility ?? 0) >= 0.65;
  for (const [a, b] of [...ARM_SEGMENTS, [11, 12]]) {
    if (visible(a) && visible(b)) line(ctx, point(a), point(b));
  }
  for (const i of [11, 12, 13, 14, 15, 16]) {
    if (visible(i)) dot(ctx, point(i), canvas.width / 130);
  }
  if (face[33] && face[263]) {
    const pixel = (p: Point) => ({ x: (1 - p.x) * canvas.width, y: p.y * canvas.height });
    ctx.strokeStyle = ctx.fillStyle = headMatches ? '#bcf38b' : '#ffd1a6';
    line(ctx, pixel(face[33]), pixel(face[263]));
    dot(ctx, pixel(face[33]), canvas.width / 200); dot(ctx, pixel(face[263]), canvas.width / 200);
  }
}
