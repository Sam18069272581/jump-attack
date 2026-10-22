import { manualProblem } from './entry';
import { getMetric } from './metrics';
import { RECOVERY_CODES, type RecoveryKey } from './recovery';

/**
 * Recovery values copied out of Apple Health by an iOS Shortcut. Expo Go can't read HealthKit, so the
 * Shortcut reads the samples and copies a few "name: value" lines, and the recovery screen pastes them in.
 */
export type HealthImport = {
  values: Partial<Record<RecoveryKey, number>>;
  /** Values that were found but can't be right, one line each. */
  problems: string[];
};

// Checked in order: 心率变异性 before 静息心率, since both say 心率.
const LABELS: [RecoveryKey, RegExp][] = [
  ['hrv', /hrv|sdnn|心率变异性|heart\s*rate\s*variability/i],
  ['rhr', /静息心率|resting\s*heart\s*rate|\brhr\b/i],
  ['resp', /呼吸|respirat|\bresp\b/i],
  ['sleep', /睡眠|sleep/i],
];

const NUMBER = /\d+(?:[.,]\d+)?/;
const num = (s: string) => Number(s.replace(',', '.'));

/** Hours from how Shortcuts may write a duration: "7.4", "7:24", "7小时24分钟", "7 hr 24 min", "444 分钟", "26640 秒". */
export function parseSleepHours(raw: string): number | null {
  const t = raw.trim();
  const clock = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const part = (re: RegExp) => {
    const m = t.match(re);
    return m ? num(m[1]) : null;
  };
  const h = part(/(\d+(?:[.,]\d+)?)\s*(?:小时|时|hours?|hrs?|h)(?![a-z])/i);
  const m = part(/(\d+(?:[.,]\d+)?)\s*(?:分钟|分|minutes?|mins?|m)(?![a-z])/i);
  const s = part(/(\d+(?:[.,]\d+)?)\s*(?:秒钟|秒|seconds?|secs?|s)(?![a-z])/i);
  if (h != null || m != null || s != null) return (h ?? 0) + (m ?? 0) / 60 + (s ?? 0) / 3600;
  const n = t.match(NUMBER);
  if (!n) return null;
  const v = num(n[0]);
  // A bare number: a night is under 24 hours, under 1440 minutes, otherwise seconds.
  return v <= 24 ? v : v <= 24 * 60 ? v / 60 : v / 3600;
}

const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

/** The recovery values in pasted text, or null when it holds none of them. The first line naming a value wins. */
export function parseHealthImport(raw: string): HealthImport | null {
  const values: Partial<Record<RecoveryKey, number>> = {};
  const problems: string[] = [];
  // One value per line; single-line JSON is split at its commas too.
  const lines = raw.split(/[\n\r;]+|,(?=\s*["'{]?\s*[A-Za-z一-鿿])/);
  for (const line of lines) {
    const hit = LABELS.find(([, re]) => re.test(line));
    if (!hit) continue;
    const [key, re] = hit;
    if (key in values) continue;
    const rest = line.slice(line.search(re)).replace(re, '').replace(/^[^\d]*?[:：=]/, '');
    const n = key === 'sleep' ? parseSleepHours(rest.replace(/["'{}]/g, '')) : rest.match(NUMBER) ? num(rest.match(NUMBER)![0]) : null;
    if (n == null) continue;
    const def = getMetric(RECOVERY_CODES[key])!;
    const v = round(n, def.decimals);
    const problem = manualProblem(def, v);
    if (problem) problems.push(problem);
    else values[key] = v;
  }
  return Object.keys(values).length || problems.length ? { values, problems } : null;
}

/** What the Shortcut copies, for a dry run without one. */
export const SAMPLE_IMPORT = 'HRV: 58 毫秒\n静息心率: 52 次/分\n睡眠: 7小时24分钟\n呼吸: 14.5 次/分';
