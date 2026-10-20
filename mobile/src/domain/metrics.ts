import { cooperVo2max, rsaSummary, yoyoVo2max } from './conditioning';

export type Category = 'jump' | 'conditioning' | 'speed' | 'vbt' | 'mobility' | 'recovery';

export type MetricDef = {
  code: string;
  name: string;
  category: Category;
  unit: string;
  decimals: number;
  /** True when a smaller value is better (sprint times, resting heart rate). */
  lowerIsBetter?: boolean;
  /** How a session's attempts become its result. Defaults to the best attempt. */
  aggregate?: 'best' | 'mean';
  /** A figure estimated from the measured value, shown alongside it (VO2max from a run distance). */
  estimate?: { name: string; unit: string; decimals: number; from: (value: number) => number };
};

export const CATEGORIES: { key: Category; name: string; color: string; tile: string; subtitle: string }[] = [
  { key: 'jump', name: '跳跃测试', color: '#D4FF3F', tile: '#2A3312', subtitle: 'CMJ · SJ · DJ · Pogo RSI' },
  { key: 'conditioning', name: '体能耐力', color: '#FF7A6B', tile: '#3A1C19', subtitle: 'VO2max · RSA 反复冲刺' },
  { key: 'speed', name: '速度训练', color: '#4FD1FF', tile: '#0F2D38', subtitle: '10 m · 30 m · 50 m · 100 m 冲刺' },
  { key: 'vbt', name: 'VBT 训练', color: '#FF9F43', tile: '#3A2512', subtitle: '深蹲 · 高翻 · 高拉 · 深蹲跳' },
  { key: 'mobility', name: '灵活度', color: '#C9A7FF', tile: '#2C2240', subtitle: '踝 · 髋 · 腘绳肌 · 胸椎 · 肩' },
  { key: 'recovery', name: '恢复', color: '#6EE7B7', tile: '#123329', subtitle: 'HRV · 静息心率 · 睡眠（Apple 健康）' },
];

/** Jump tests measured by flight time from video. */
export const JUMP_TESTS: (MetricDef & { short: string; color: string })[] = [
  { code: 'cmj', short: 'CMJ', name: 'CMJ 反向跳', category: 'jump', unit: 'cm', decimals: 1, color: '#D4FF3F' },
  { code: 'sj', short: 'SJ', name: 'SJ 蹲跳', category: 'jump', unit: 'cm', decimals: 1, color: '#4FD1FF' },
  { code: 'sl_cmj_l', short: 'SL-L', name: '单腿 CMJ · 左', category: 'jump', unit: 'cm', decimals: 1, color: '#6EE7B7' },
  { code: 'sl_cmj_r', short: 'SL-R', name: '单腿 CMJ · 右', category: 'jump', unit: 'cm', decimals: 1, color: '#6EE7B7' },
];

const VO2MAX = { name: 'VO2max', unit: 'ml/kg/min', decimals: 1 };

/** Field tests for aerobic capacity and repeated sprints; protocols in ./conditioning. */
export const CONDITIONING_TESTS: (MetricDef & { short: string; color: string; summary: string; kit: string })[] = [
  {
    code: 'yoyo_ir1',
    short: 'YO-YO',
    name: 'Yo-Yo 间歇恢复测试 1 级',
    category: 'conditioning',
    unit: 'm',
    decimals: 0,
    color: '#FF7A6B',
    summary: '20 m 往返跑，每趟后 10 秒恢复，越来越快，跑不动为止',
    kit: '20 m 场地 · 3 个标志桶 · 约 6–20 分钟',
    estimate: { ...VO2MAX, from: yoyoVo2max },
  },
  {
    code: 'cooper',
    short: '12MIN',
    name: 'Cooper 12 分钟跑',
    category: 'conditioning',
    unit: 'm',
    decimals: 0,
    color: '#FFB86B',
    summary: '12 分钟内跑尽量远，按距离估算 VO2max',
    kit: '田径场或已知距离的环线 · 12 分钟',
    estimate: { ...VO2MAX, from: cooperVo2max },
  },
  {
    code: 'rsa',
    short: 'RSA',
    name: 'RSA 反复冲刺 6×(20+20 m)',
    category: 'conditioning',
    unit: 's',
    decimals: 2,
    lowerIsBetter: true,
    aggregate: 'mean',
    color: '#4FD1FF',
    summary: '6 趟 20 m 折返冲刺，每趟间休 20 秒，看平均时间和掉速',
    kit: '20 m 场地 · 2 个标志桶 · 最好有同伴按表 · 约 3 分钟',
  },
];

export const METRICS: MetricDef[] = [...JUMP_TESTS, ...CONDITIONING_TESTS];

export function getMetric(code: string): MetricDef | undefined {
  return METRICS.find((m) => m.code === code);
}

export function formatValue(metric: MetricDef, value: number): string {
  return value.toFixed(metric.decimals);
}

/** The secondary figure for a session: the VO2max a run distance implies, or how much a sprint set slowed down. */
export function resultNote(metric: MetricDef, result: number, attempts: number[] = []): string | null {
  if (metric.estimate) return `${metric.estimate.name} ≈ ${metric.estimate.from(result).toFixed(metric.estimate.decimals)}`;
  if (metric.aggregate === 'mean' && attempts.length > 1) {
    const s = rsaSummary(attempts);
    return `最快 ${s.best.toFixed(metric.decimals)} ${metric.unit} · 递减 ${s.sdec.toFixed(1)}%`;
  }
  return null;
}
