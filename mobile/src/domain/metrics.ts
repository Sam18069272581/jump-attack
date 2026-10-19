export type Category = 'jump' | 'speed' | 'vbt' | 'mobility' | 'recovery';

export type MetricDef = {
  code: string;
  name: string;
  category: Category;
  unit: string;
  decimals: number;
  /** True when a smaller value is better (sprint times, resting heart rate). */
  lowerIsBetter?: boolean;
};

export const CATEGORIES: { key: Category; name: string; color: string; tile: string; subtitle: string }[] = [
  { key: 'jump', name: '跳跃测试', color: '#D4FF3F', tile: '#2A3312', subtitle: 'CMJ · SJ · DJ · Pogo RSI' },
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

export const METRICS: MetricDef[] = [...JUMP_TESTS];

export function getMetric(code: string): MetricDef | undefined {
  return METRICS.find((m) => m.code === code);
}

export function formatValue(metric: MetricDef, value: number): string {
  return value.toFixed(metric.decimals);
}
