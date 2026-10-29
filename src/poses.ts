export interface Point { x: number; y: number; visibility?: number }
export interface Pose {
  id: string;
  description: { en: string; zh: string };
  // Directions in the mirrored preview: 0° right, 90° down, -90° up.
  angles: readonly [number, number, number, number];
  // Signed screen-space roll relative to the shoulders; positive leans right.
  // Omitted on the original arm-only poses so they do not require face tracking.
  headTilt?: number;
}

export const POSES: readonly Pose[] = [
  { id: 't', description: { en: 'Both arms straight out to the sides', zh: '双臂向两侧平举' }, angles: [180, 180, 0, 0] },
  { id: 'v', description: { en: 'Both arms diagonally upward', zh: '双臂斜向上展开' }, angles: [-130, -130, -50, -50] },
  { id: 'goal', description: { en: 'Upper arms horizontal, forearms up', zh: '上臂平举，前臂朝上' }, angles: [180, -90, 0, -90] },
  { id: 'left-up', description: { en: 'Screen-left arm up, screen-right arm out', zh: '画面左臂举高，右臂平举' }, angles: [-90, -90, 0, 0] },
  { id: 'right-up', description: { en: 'Screen-right arm up, screen-left arm out', zh: '画面右臂举高，左臂平举' }, angles: [180, 180, -90, -90] },
  { id: 'down', description: { en: 'Both arms diagonally downward', zh: '双臂斜向下展开' }, angles: [135, 135, 45, 45] },
  { id: 'goal-down', description: { en: 'Upper arms horizontal, forearms down', zh: '上臂平举，前臂朝下' }, angles: [180, 90, 0, 90] },
  { id: 'left-bend', description: { en: 'Screen-left elbow bent upward, other arm out', zh: '画面左臂屈肘朝上，右臂平举' }, angles: [180, -90, 0, 0] },
  { id: 'right-bend', description: { en: 'Screen-right elbow bent upward, other arm out', zh: '画面右臂屈肘朝上，左臂平举' }, angles: [180, 180, 0, -90] },
  { id: 'left-diagonal', description: { en: 'Screen-left arm diagonally up, other arm out', zh: '画面左臂斜向上，右臂平举' }, angles: [-130, -130, 0, 0] },
  { id: 'right-diagonal', description: { en: 'Screen-right arm diagonally up, other arm out', zh: '画面右臂斜向上，左臂平举' }, angles: [180, 180, -50, -50] },
  { id: 'left-up-right-down', description: { en: 'Screen-left arm up, other arm diagonally down', zh: '画面左臂举高，右臂斜向下' }, angles: [-90, -90, 45, 45] },
  { id: 'right-up-left-down', description: { en: 'Screen-right arm up, other arm diagonally down', zh: '画面右臂举高，左臂斜向下' }, angles: [135, 135, -90, -90] },
  { id: 'up', description: { en: 'Both arms straight up', zh: '双臂向上举直' }, angles: [-90, -90, -90, -90] },
  { id: 'shrug-left', description: { en: 'Arms open with bent elbows, head tilted left', zh: '屈肘摊开双臂，头向左歪' }, angles: [135, -135, 45, -45], headTilt: -24 },
  { id: 'shrug-right', description: { en: 'Arms open with bent elbows, head tilted right', zh: '屈肘摊开双臂，头向右歪' }, angles: [135, -135, 45, -45], headTilt: 24 },
  { id: 'robot-left', description: { en: 'Left forearm up, right forearm down, head tilted left', zh: '左前臂向上、右前臂向下，头向左歪' }, angles: [180, -90, 0, 90], headTilt: -24 },
  { id: 'robot-right', description: { en: 'Left forearm up, right forearm down, head tilted right', zh: '左前臂向上、右前臂向下，头向右歪' }, angles: [180, -90, 0, 90], headTilt: 24 },
  { id: 'reverse-robot-left', description: { en: 'Left forearm down, right forearm up, head tilted left', zh: '左前臂向下、右前臂向上，头向左歪' }, angles: [180, 90, 0, -90], headTilt: -24 },
  { id: 'reverse-robot-right', description: { en: 'Left forearm down, right forearm up, head tilted right', zh: '左前臂向下、右前臂向上，头向右歪' }, angles: [180, 90, 0, -90], headTilt: 24 },
];

export const ARM_SEGMENTS = [[11, 13], [13, 15], [12, 14], [14, 16]] as const;

export function angleDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function choosePose(previousId?: string, random = Math.random): Pose {
  const options = POSES.filter(p => p.id !== previousId);
  return options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))];
}

