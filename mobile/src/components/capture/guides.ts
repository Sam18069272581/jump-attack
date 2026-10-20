import type { Category } from '@/domain/metrics';

/** Filming instructions for one kind of test, shared by in-app recording and the Expo Go slow-motion import. */
export type CaptureGuide = {
  /** Steps for filming with the system camera's slow-motion mode, then importing. */
  steps: { title: string; text: string }[];
  /** Reminders over the live viewfinder. */
  checks: string[];
  /** Draw the foot box and ground line used to frame a jump. */
  feetOverlay: boolean;
  recordingHint: string;
  doneHint: string;
  tips: string;
  maxSeconds: number;
};

const SLOW_MO_SETUP = { title: '打开 240 fps 慢动作', text: 'iPhone 设置 → 相机 → 录制慢动作，选「1080p，240 fps」。只需设一次。' };

const JUMP: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '把手机放稳', text: '放在地面或三脚架上，别手持。距离约 1.5 米，镜头对准脚踝高度，脚和地面都要在画面里。' },
    { title: '用「慢动作」拍', text: '打开相机切到「慢动作」。起跳前 2 秒开拍，落地站稳 2 秒后再停，让整个跳跃都在慢放段里。' },
    { title: '导入并逐帧标记', text: '回到这里点下面的按钮选视频，然后找到起跳帧和落地帧。' },
  ],
  checks: ['手机放稳（地面或三脚架），别手持', '距离约 1.5 米，镜头对准脚踝'],
  feetOverlay: true,
  recordingHint: '完成一次起跳并落地后，点击停止',
  doneHint: '下一步逐帧找到起跳和落地。',
  tips: '1. 手机横放或竖放在地面/三脚架上，镜头对准脚踝高度。\n2. 运动员站在框内，完成一次起跳并落地。\n3. 落地站稳后再停止录制。\n4. 优先用 240 fps，误差约 ±4 ms。',
  maxSeconds: 15,
};

const SPRINT: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '侧对跑道放好手机', text: '三脚架放在跑道侧面，起点线和终点线都要在画面里（10 m 大约要站 8–10 米远）。手机横放，别手持。' },
    { title: '用「慢动作」拍', text: '起跑前 2 秒开拍，冲过终点后再停。' },
    { title: '导入并逐帧标记', text: '找到身体第一次动的起跑帧，和躯干越过终点线的冲线帧。' },
  ],
  checks: ['手机放稳，侧对跑道', '起点线和终点线都在画面里'],
  feetOverlay: false,
  recordingHint: '冲过终点后，点击停止',
  doneHint: '下一步逐帧找到起跑和冲线。',
  tips: '1. 三脚架放在跑道侧面，起点和终点都在画面里。\n2. 起跑前开拍，冲过终点后停止。\n3. 30 m 以上一台手机拍不全时，用光电门或秒表计时，再手动输入成绩。',
  maxSeconds: 30,
};

const LIFT: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '侧面拍杠铃', text: '三脚架放在侧面 2–3 米，镜头和杠铃同高，杠铃片的整个上下行程都要在画面里。' },
    { title: '用「慢动作」拍一组', text: '开拍后再开始这一组，做完再停。' },
    { title: '导入并逐帧标记', text: '选最快的一次，标出杠铃开始上升和到最高点的两帧。' },
  ],
  checks: ['手机放稳，侧对杠铃', '杠铃整个行程都在画面里'],
  feetOverlay: false,
  recordingHint: '做完这一组后，点击停止',
  doneHint: '下一步逐帧找到向心开始和结束。',
  tips: '1. 三脚架放在侧面，镜头和杠铃同高。\n2. 杠铃的整个行程都要在画面里。\n3. 行程用卷尺量一次：杠铃最低点到最高点的距离。',
  maxSeconds: 30,
};

export function captureGuide(category: Category): CaptureGuide {
  return category === 'speed' ? SPRINT : category === 'vbt' ? LIFT : JUMP;
}
