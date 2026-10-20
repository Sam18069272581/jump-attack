import { mean, sd } from './assess';
import { addDays, type ISODate } from './dates';

/** One day's recovery values; missing ones are null. */
export type RecoveryDay = { date: ISODate; hrv: number | null; rhr: number | null; sleep: number | null; resp: number | null };

export const RECOVERY_CODES = { hrv: 'rec_hrv', rhr: 'rec_rhr', sleep: 'rec_sleep', resp: 'rec_resp' } as const;
export type RecoveryKey = keyof typeof RECOVERY_CODES;

/** Days of history a baseline is built from, and the fewest that make it meaningful. */
export const BASELINE_DAYS = 7;
export const MIN_BASELINE_DAYS = 3;
/** Resting heart rate this far above its baseline is a warning sign. */
export const RHR_RISE = 5;
/** Less sleep than this is flagged. */
export const SHORT_SLEEP_H = 6;

export type Baseline = { mean: number; low: number; high: number; n: number };

/** The normal range from the days before `date`: mean ± 1 SD, at least ±3 % so a very steady week isn't over-sensitive. */
export function baseline(days: RecoveryDay[], key: RecoveryKey, date: ISODate): Baseline | null {
  const from = addDays(date, -BASELINE_DAYS);
  const xs = days.filter((d) => d.date >= from && d.date < date && d[key] != null).map((d) => d[key]!);
  if (xs.length < MIN_BASELINE_DAYS) return null;
  const m = mean(xs);
  const half = Math.max(sd(xs), 0.03 * m);
  return { mean: m, low: m - half, high: m + half, n: xs.length };
}

export type RecoveryStatus = 'good' | 'fair' | 'poor' | 'unknown';

export type RecoveryRead = {
  status: RecoveryStatus;
  /** Why the status is what it is, one line per signal. */
  reasons: string[];
  /** The reasons that are warning signs. */
  warnings: string[];
  hrv: Baseline | null;
  rhr: Baseline | null;
};

/**
 * Today's recovery from HRV against its 7-day baseline, resting heart rate and sleep.
 * HRV below its normal range means the body hasn't recovered: train lighter. A raised resting heart rate
 * or a short night alone is a softer warning.
 */
export function readRecovery(days: RecoveryDay[], date: ISODate): RecoveryRead {
  const today = days.find((d) => d.date === date);
  const hrv = baseline(days, 'hrv', date);
  const rhr = baseline(days, 'rhr', date);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const warn = (r: string) => (reasons.push(r), warnings.push(r));
  let hard = 0;
  let soft = 0;

  if (today?.hrv != null && hrv) {
    if (today.hrv < hrv.low) {
      hard++;
      warn(`HRV ${Math.round(today.hrv)} ms，低于你 7 天基线 ${Math.round(hrv.low)}–${Math.round(hrv.high)}`);
    } else {
      reasons.push(`HRV 在你 7 天基线范围内（${Math.round(hrv.low)}–${Math.round(hrv.high)}）`);
    }
  }
  if (today?.rhr != null && rhr) {
    const d = today.rhr - rhr.mean;
    if (d >= RHR_RISE) {
      soft++;
      warn(`静息心率比 7 天平均高 ${Math.round(d)} bpm`);
    } else if (d <= -1) {
      reasons.push(`静息心率略低于平时`);
    }
  }
  if (today?.sleep != null && today.sleep < SHORT_SLEEP_H) {
    soft++;
    warn(`睡眠只有 ${today.sleep.toFixed(1)} 小时`);
  }

  const known = (today?.hrv != null && hrv != null) || (today?.rhr != null && rhr != null) || today?.sleep != null;
  const status: RecoveryStatus = !known ? 'unknown' : hard > 0 || soft >= 2 ? 'poor' : soft === 1 ? 'fair' : 'good';
  return { status, reasons, warnings, hrv, rhr };
}

export const STATUS_TEXT: Record<RecoveryStatus, { label: string; advice: string }> = {
  good: { label: '良好', advice: '适合高强度训练' },
  fair: { label: '一般', advice: '可以按计划练，注意强度' },
  poor: { label: '疲劳', advice: '今天的训练会自动减量' },
  unknown: { label: '数据不足', advice: '记录几天 HRV 和静息心率后就能判断' },
};
