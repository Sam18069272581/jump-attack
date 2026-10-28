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
    { title: '导入自动分析', text: '回到这里点下面的按钮选视频，框出要分析的那段、点一下运动员，App 自动找出每一跳的起跳和落地，不准可以逐帧调。' },
  ],
  checks: ['手机放稳（地面或三脚架），别手持', '距离约 1.5 米，镜头对准脚踝'],
  feetOverlay: true,
  recordingHint: '完成一次起跳并落地后，点击停止',
  doneHint: '下一步逐帧找到起跳和落地。',
  tips: '1. 手机横放或竖放在地面/三脚架上，镜头对准脚踝高度。\n2. 运动员站在框内，完成一次起跳并落地。\n3. 落地站稳后再停止录制。\n4. 优先用 240 fps，误差约 ±4 ms。',
  maxSeconds: 15,
};

const DROP_JUMP: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '侧面拍箱子和落点', text: '手机放在地面或三脚架上，距离约 2 米，镜头对准脚踝高度。箱子边缘和落地点都要在画面里。' },
    { title: '用「慢动作」拍', text: '站上箱子后开拍。一只脚迈出箱子自然落下（别往下跳也别往上跳），一着地就尽快弹起，落地站稳后再停。' },
    { title: '导入自动分析', text: 'App 自动找三帧：跳下后脚刚着地、反弹脚尖刚离地、再次落地，不准可以逐帧调。' },
  ],
  checks: ['手机放稳，侧对箱子', '箱子边缘和落地点都在画面里'],
  feetOverlay: true,
  recordingHint: '反弹并落地站稳后，点击停止',
  doneHint: '下一步逐帧找到触地、起跳和落地。',
  tips: '1. 手机放在侧面，箱子和落地点都在画面里。\n2. 从箱子上迈出落下，着地后尽快弹起，双手叉腰。\n3. 落地站稳后再停止录制。\n4. 优先用 240 fps，触地时间误差约 ±4 ms。',
  maxSeconds: 15,
};

const REPEATED_JUMP: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '把手机放稳', text: '放在地面或三脚架上，距离约 1.5 米，镜头对准脚踝高度。原地连跳，脚别跳出画面。' },
    { title: '用「慢动作」拍', text: '开拍后原地连续跳 10 次：每次尽量跳高、触地尽量短，双手叉腰，脚尖着地马上弹起。跳完站稳再停。' },
    { title: '导入自动分析', text: '选好视频后点一下运动员，App 会认出每一跳，算触地时间、RSI 和稳定性。' },
  ],
  checks: ['手机放稳，镜头对准脚踝', '原地连跳，脚别出画'],
  feetOverlay: true,
  recordingHint: '连跳 10 次站稳后，点击停止',
  doneHint: '下一步自动认出每一跳。',
  tips: '1. 手机放在地面或三脚架上，镜头对准脚踝高度。\n2. 原地连跳 10 次，每次都要又高又快。\n3. 优先用 240 fps，触地时间误差约 ±4 ms。',
  maxSeconds: 15,
};

const APPROACH_TOUCH: CaptureGuide = {
  steps: [
    SLOW_MO_SETUP,
    { title: '侧面拍起跳点', text: '手机放在地面或三脚架上，距离约 3 米，镜头对准脚踝高度。最后一步和落地点都要在画面里。' },
    { title: '用「慢动作」拍', text: '助跑前开拍，3–5 步助跑后全力起跳摸高，落地站稳再停。落地时腿尽量伸直、像起跳时一样，不然腾空时间会算长。' },
    { title: '导入自动分析', text: 'App 自动找起跳脚刚离地的一帧，和第一只脚刚着地的一帧，不准可以逐帧调。摸高 = 站立摸高 + 跳高。' },
  ],
  checks: ['手机放稳，侧对起跳点', '最后一步和落地点都在画面里'],
  feetOverlay: false,
  recordingHint: '落地站稳后，点击停止',
  doneHint: '下一步逐帧找到起跳和落地。',
  tips: '1. 手机放在侧面，起跳点和落地点都在画面里。\n2. 3–5 步助跑，全力起跳摸高，落地时腿伸直。\n3. 有墙或篮板上的刻度时，直接手填摸到的高度更准。',
  maxSeconds: 20,
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

/** How to film a set for automatic bar tracking: normal 60 fps video, side-on, with a 45 cm plate as the scale. */
export const LIFT_SETUP = [
  { title: '相机设成 60 fps', text: '设置 → 相机 → 录制视频，选「1080p，60 fps」。用普通视频拍，不用慢动作。' },
  { title: '最外侧挂 45 cm 的标准片', text: '对着镜头的最外面一片要是直径 45 cm 的标准片（20/25 kg 片，或同样大小的 10/15 kg 保护片）。App 用它当尺子，小片会算错。' },
  { title: '侧面放稳，正对杠铃端头', text: '三脚架或凳子上放稳，别手持。离杠铃片 1.5–2 米，镜头正对杠铃的一端，左右偏不超过 25°；镜头高度在膝盖到胸口之间。' },
  { title: '竖着拍，上下留空', text: '整组里杠铃片要一直完整地在画面里，上下各留出一片杠铃片的空。光线要足，别对着窗户或灯。' },
  { title: '先开拍再起杠', text: '开始录再起杠，做完放回架子再停。一个视频拍一组。' },
];

const LIFT: CaptureGuide = {
  steps: LIFT_SETUP,
  checks: ['手机放稳，侧对杠铃端头', '外侧是 45 cm 标准片，整个行程都在画面里'],
  feetOverlay: false,
  recordingHint: '做完这一组后，点击停止',
  doneHint: '下一步圈出杠铃片，自动分析。',
  tips: '1. 三脚架放在侧面 1.5–2 米，正对杠铃一端。\n2. 外侧挂 45 cm 标准片。\n3. 杠铃片的整个行程都要在画面里。',
  maxSeconds: 60,
};

export function captureGuide(category: Category, code?: string): CaptureGuide {
  if (code === 'dj_rsi') return DROP_JUMP;
  if (code === 'rj_rsi') return REPEATED_JUMP;
  if (code === 'approach_touch') return APPROACH_TOUCH;
  return category === 'speed' ? SPRINT : category === 'vbt' ? LIFT : JUMP;
}
