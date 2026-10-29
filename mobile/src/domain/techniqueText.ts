/**
 * What the technique screens call each figure, flag and problem of the analysis (domain/technique.ts), and how a
 * figure is written with its error.
 */
import type { Measured, MetricKey, QualityFlag, TechniqueProblem } from './technique';

import { localized, tr } from '@/i18n';

export type MetricText = { name: string; unit: string; decimals: number; hint: string };

/** In the order they are shown: the take-off first, then the run-up and the plant that make it. */
export const METRIC_TEXT: Record<MetricKey, MetricText> = {
  vz: { name: '起跳垂直速度', unit: 'm/s', decimals: 2, hint: '决定能跳多高：重心升高 = 速度² ÷ 2g' },
  angle: { name: '起跳角度', unit: '°', decimals: 0, hint: '重心离地时速度方向和地面的夹角' },
  vx: { name: '起跳水平速度', unit: 'm/s', decimals: 2, hint: '离地时还带着的向前速度' },
  approach: { name: '助跑速度', unit: 'm/s', decimals: 2, hint: '髋部经过两条线之间（最后 3 米）的平均速度' },
  brake: { name: '踏跳刹车', unit: 'm/s', decimals: 2, hint: '最后一步落地前到离地，水平速度少了多少' },
  plant: { name: '最后一步触地', unit: 'ms', decimals: 0, hint: '起跳脚落地到离地的时间' },
  gap: { name: '双脚落地间隔', unit: 'ms', decimals: 0, hint: '双脚起跳时，两只脚先后落地差多少' },
  step: { name: '最后一步步长', unit: 'm', decimals: 2, hint: '倒数第二步脚尖到最后一步脚尖' },
  knee: { name: '起跳腿最小膝角', unit: '°', decimals: 0, hint: '踏跳时膝盖弯得最深的角度，180° 是伸直' },
  trunk: { name: '踏跳时躯干后仰', unit: '°', decimals: 0, hint: '最后一步落地那一刻，上身向后仰多少（负数是前倾）' },
};

export const METRIC_ORDER = Object.keys(METRIC_TEXT) as MetricKey[];

/** A figure's error to the figure's precision, never less than one unit of the last digit: "± 0" would claim it exact. */
export function formatError(key: MetricKey, error: number): string {
  const d = METRIC_TEXT[key].decimals;
  return Math.max(error, 10 ** -d).toFixed(d);
}

/** "3.30 ± 0.04 m/s"; a figure less sure than its pass line says so instead of passing for a number to trust. */
export function formatMeasured(key: MetricKey, m: Measured): string {
  const t = METRIC_TEXT[key];
  const sep = t.unit === '°' ? '' : ' ';
  const text = `${m.value.toFixed(t.decimals)} ± ${formatError(key, m.error)}${sep}${t.unit}`;
  return m.status === 'ok' ? text : tr('{text}（不够准）', { text });
}

export const FLAG_TEXT: Record<QualityFlag, string> = {
  'low-fps': '帧率不到 240：触地时间和起跳速度只能粗略算。要准就用 iPhone 慢动作（240 帧）拍，再导入。',
  'no-markers': '没点地上的两条线：没有助跑速度，长度按重力换算。',
  'off-line': '起跳点不在两条线那条直线上：长度和速度会有些偏差。',
  'scale-broken': '两条线算出的比例和重力对不上：多半是拍摄帧率选错了，或者线点错了。速度、时间和长度先不给，改好再分析一次。',
  gaps: '中间有一段没认出运动员。',
  'far-foot': '起跳脚是离手机远的那只，挡得多，触地时间可能不够准。',
  curved: '助跑斜着朝手机跑来：沿画面量的速度会偏小。',
  hang: '手碰到篮筐，腾空没有完整的自由落体：起跳速度只用了上升段。',
  'cut-off': '视频在落地前就结束了。',
  unseen: '有的关键时刻视频里看不到（在视频开始之前，或者那几帧没认出人），靠它算的数就不给了。',
};

export const PROBLEM_TEXT: Record<TechniqueProblem, { what: string; advice: string }> = {
  'no-athlete': { what: '没跟住运动员', advice: '点准运动员；人要全身在画面里，别太小（至少画面高度的五分之一）。' },
  'no-jump': { what: '没找到起跳', advice: '视频里要有完整的助跑、起跳和落地；拍摄帧率选对。' },
  'no-plant': { what: '找到了腾空，但起跳那一步不在视频里', advice: '从最后两步之前就开始拍，起跳点放在画面中间偏落地那边。' },
  markers: { what: '两条线点得太近', advice: '起跳线点在起跳点的胶带上，3 米线点在往回 3 米的那条胶带上；没贴线就点「没贴线，跳过」。' },
};

// Shown in the current language (i18n).
localized(METRIC_TEXT, 'name', 'hint');
localized(FLAG_TEXT);
localized(PROBLEM_TEXT);
