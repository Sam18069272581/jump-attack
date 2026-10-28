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

/** Days of HRV history the baseline is built from, and the days averaged for the trend (Plews et al. 2012, 2013). */
export const HRV_BASELINE_DAYS = 30;
export const HRV_ROLLING_DAYS = 7;
/** The trend counts as down once it is half a baseline SD under the mean: the smallest worthwhile change. */
export const HRV_SWC_SD = 0.5;

/**
 * HRV's normal range from the 30 days before `date`, worked out on ln(HRV) as HRV is skewed: the log-mean ± 1 SD (at
 * least ±3 %, as for the other signals), turned back into ms. `logMean` and `logSd` are what the trend is judged on.
 */
export function hrvBaseline(days: RecoveryDay[], date: ISODate): (Baseline & { logMean: number; logSd: number }) | null {
  const from = addDays(date, -HRV_BASELINE_DAYS);
  const xs = days.filter((d) => d.date >= from && d.date < date && d.hrv != null && d.hrv > 0).map((d) => Math.log(d.hrv!));
  if (xs.length < MIN_BASELINE_DAYS) return null;
  const m = mean(xs);
  const s = Math.max(sd(xs), Math.log(1.03));
  return { mean: Math.exp(m), low: Math.exp(m - s), high: Math.exp(m + s), n: xs.length, logMean: m, logSd: s };
}

/** Whether `date`'s HRV was under its own baseline's normal range. */
function hrvLowOn(days: RecoveryDay[], date: ISODate): boolean {
  const hrv = days.find((d) => d.date === date)?.hrv;
  const b = hrvBaseline(days, date);
  return hrv != null && b != null && hrv < b.low;
}

/** How far back the previous HRV reading may be and still count as "again": a skipped morning doesn't break a run. */
export const HRV_REPEAT_DAYS = 2;

/** Whether the latest HRV reading in the `HRV_REPEAT_DAYS` before `date` was low too. */
function hrvLowBefore(days: RecoveryDay[], date: ISODate): boolean {
  for (let i = 1; i <= HRV_REPEAT_DAYS; i++) {
    const d = addDays(date, -i);
    if (days.some((x) => x.date === d && x.hrv != null)) return hrvLowOn(days, d);
  }
  return false;
}

/** The mean ln(HRV) of the 7 days up to and including `date`, over the days that have one. */
function hrvTrend(days: RecoveryDay[], date: ISODate): number | null {
  const from = addDays(date, 1 - HRV_ROLLING_DAYS);
  const xs = days.filter((d) => d.date >= from && d.date <= date && d.hrv != null && d.hrv > 0).map((d) => Math.log(d.hrv!));
  return xs.length ? mean(xs) : null;
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
 * Today's recovery from HRV against its 30-day baseline, resting heart rate and sleep.
 * HRV below its normal range for more than a day means the body hasn't recovered: train lighter. One low HRV reading,
 * a raised resting heart rate or a short night is a softer warning; two of them together are poor.
 */
export function readRecovery(days: RecoveryDay[], date: ISODate): RecoveryRead {
  const today = days.find((d) => d.date === date);
  const hrv = hrvBaseline(days, date);
  const rhr = baseline(days, 'rhr', date);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const warn = (r: string) => (reasons.push(r), warnings.push(r));
  let hard = 0;
  let soft = 0;

  if (today?.hrv != null && hrv) {
    const range = `${Math.round(hrv.low)}–${Math.round(hrv.high)}`;
    if (today.hrv < hrv.low) {
      // Low for more than a day: the 7-day mean is down, or the previous reading was low against its own baseline too
      // (which catches a run of low days while the history is still too short for the mean to move).
      const trend = hrvTrend(days, date);
      const trendLow = trend != null && trend < hrv.logMean - HRV_SWC_SD * hrv.logSd;
      if (trendLow || hrvLowBefore(days, date)) {
        hard++;
        warn(`HRV ${Math.round(today.hrv)} ms，低于你 30 天基线 ${range}，${trendLow ? '7 天平均也偏低' : '前一次也偏低'}`);
      } else {
        soft++;
        warn(`HRV ${Math.round(today.hrv)} ms，低于你 30 天基线 ${range}（7 天平均还正常）`);
      }
    } else {
      reasons.push(`HRV 在你 30 天基线范围内（${range}）`);
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
