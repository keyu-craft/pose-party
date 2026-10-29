const joints = ['left-shoulder', 'right-shoulder', 'left-elbow', 'right-elbow', 'left-wrist', 'right-wrist'];
const categories = ['missing', 'non-finite', 'low-confidence', 'out-of-frame'];
export const TRACKING_REASONS = new Set([
  ...joints.flatMap(joint => categories.map(category => `${joint}-${category}`)),
  'body-not-found', 'invalid-frame-size', 'shoulders-too-small', 'shoulders-too-tilted',
  'left-upper-arm-collapsed', 'left-forearm-collapsed', 'right-upper-arm-collapsed', 'right-forearm-collapsed',
  'face-missing', 'face-landmarks-missing', 'face-out-of-frame', 'face-too-small', 'face-body-mismatch', 'face-not-frontal', 'face-matrix-missing',
  'arms-angle', 'head-angle', 'stale-frame',
  'frame-top', 'frame-bottom', 'frame-left', 'frame-right', 'framing-step-back', 'framing-center', 'framing-shoulders',
]);

export function reasonLabel(code: string, language: 'en' | 'zh'): string {
  const joint = code.match(/^(left|right)-(shoulder|elbow|wrist)-(missing|non-finite|low-confidence|out-of-frame)$/);
  if (joint) {
    const side = language === 'zh' ? (joint[1] === 'left' ? '左' : '右') : (joint[1] === 'left' ? 'Left ' : 'Right ');
    const part = language === 'zh' ? ({ shoulder: '肩膀', elbow: '手肘', wrist: '手腕' }[joint[2]] ?? '') : joint[2];
    const category = language === 'zh' ? ({ missing: '未检测到', 'non-finite': '数据无效', 'low-confidence': '可见性不足', 'out-of-frame': '出画' }[joint[3]] ?? '') : ({ missing: 'missing', 'non-finite': 'invalid reading', 'low-confidence': 'low visibility', 'out-of-frame': 'out of frame' }[joint[3]] ?? '');
    return `${side}${part} · ${category}`;
  }
  const labels: Record<string, [string, string]> = {
    'body-not-found': ['Body not detected', '未检测到身体'], 'invalid-frame-size': ['Invalid camera frame', '摄像头画面尺寸无效'],
    'shoulders-too-small': ['Shoulder span too small', '肩部跨度过小'], 'shoulders-too-tilted': ['Shoulder tilt outside range', '肩线倾斜超过范围'],
    'face-missing': ['Face not detected', '未检测到面部'], 'face-landmarks-missing': ['Face/body landmarks incomplete', '面部或身体检测不完整'],
    'face-out-of-frame': ['Face outside frame', '面部出画'], 'face-too-small': ['Face too small', '面部画面过小'],
    'face-body-mismatch': ['Face/body alignment failed', '面部与身体位置不一致'], 'face-not-frontal': ['Face turned away', '面部转向过大'], 'face-matrix-missing': ['Head orientation unavailable', '头部朝向不可用'],
    'arms-angle': ['Arm angle outside tolerance', '手臂角度尚未匹配'], 'head-angle': ['Head tilt outside tolerance', '头部倾斜尚未匹配'], 'stale-frame': ['Late result discarded', '识别结果过期'],
    'frame-top': ['Joint beyond top edge', '关节超出画面顶部'], 'frame-bottom': ['Joint beyond bottom edge', '关节超出画面底部'],
    'frame-left': ['Joint beyond screen-left edge', '关节超出画面左侧'], 'frame-right': ['Joint beyond screen-right edge', '关节超出画面右侧'],
    'framing-step-back': ['Not enough room for arm targets', '站位过近或上下空间不足'], 'framing-center': ['Move toward the center', '站位偏离画面中央'], 'framing-shoulders': ['Shoulders not visible enough', '肩部未完整可见'],
  };
  if (labels[code]) return labels[code][language === 'zh' ? 1 : 0];
  return language === 'zh' ? '肢体方向难以判断' : 'Limb direction uncertain';
}
