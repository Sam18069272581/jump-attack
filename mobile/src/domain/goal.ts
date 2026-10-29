import type { TouchResult } from './blocks';
import { addDays, daysBetween, shortDate, type ISODate } from './dates';
import type { BlockType } from './dunk';
import type { SessionTemplate, WeekSpec } from './plan';

import { localized, tr } from '@/i18n';

export type { TouchResult };

/**
 * The dunk goal's date: the plan counts back from it. No new strength block in its last 6 weeks, a taper in its last
 * 10 days, and on the day itself the dunk test.
 */

/** Strength gains take weeks to show up in the jump, so a strength block starting this close to the goal is put off. */
export const NO_STRENGTH_DAYS = 42;

/** Bosquet 2007 meta-analysis: tapers of 8–14 days that cut volume 41–60% and keep intensity work best. */
export const TAPER_DAYS = 10;

/** Half the sets, same intensity and the same training days. */
export const TAPER: WeekSpec = { phase: 'deload', setFactor: 0.5 };

/** The goal day: warm up, test the touch, then try to dunk. Planned whatever the weekday. */
export const DUNK_TEST_SESSION: SessionTemplate = localized({
  code: 'D',
  name: '扣篮测试日',
  focus: '热身 → 助跑摸高测试 → 扣篮尝试',
  items: [
    { code: 'dunk_warmup', name: '热身', kind: 'technique', sets: 1, reps: 1, cue: '慢跑 5 分钟、动态拉伸，再做几次由慢到快的助跑起跳' },
    { code: 'dunk_touch_test', name: '助跑摸高测试', kind: 'transfer', sets: 1, reps: 6, jump: true, cue: '跳 6 次，每次休息 1 分钟' },
    { code: 'dunk_attempts', name: '扣篮尝试', kind: 'transfer', sets: 1, reps: 5, jump: true, cue: '每试一次在「扣篮尝试」里点一下' },
  ],
}, 'name', 'focus', 'cue');

export const DEFERRED_STRENGTH_REASON = '离目标日不到 6 周，力量还是短板，目标日后再练；先练转化，深蹲每周维持两次。';

/** What the goal makes of a day: the dunk test, the taper before it, or nothing. */
export function goalDay(goal: ISODate | null | undefined, date: ISODate): 'test' | 'taper' | null {
  if (!goal) return null;
  const left = daysBetween(date, goal);
  return left === 0 ? 'test' : left > 0 && left <= TAPER_DAYS ? 'taper' : null;
}

/** A strength block starting on `start` would end too close to the goal to pay off; train transfer instead. */
export function defersStrength(type: BlockType, start: ISODate, goal: ISODate | null | undefined): boolean {
  if (type !== 'strength' || !goal) return false;
  const left = daysBetween(start, goal);
  return left > 0 && left < NO_STRENGTH_DAYS;
}

/** Only recent tests say how the athlete is improving now. */
export const FORECAST_WINDOW_DAYS = 42;
/** A trend from fewer tests, or over less time, swings with every jump. */
export const FORECAST_MIN_TESTS = 4;
export const FORECAST_MIN_SPAN_DAYS = 14;

/** Two-sided 95% t values for 1–30 degrees of freedom; 1.96 beyond. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069,
  2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export type Forecast =
  | { kind: 'few'; tests: number }
  /** The trend line is at or over the dunk line today. */
  | { kind: 'reached' }
  | { kind: 'flat'; cmPerWeek: number }
  /** `latest` is null when the slope could be flat: no telling how late. */
  | { kind: 'date'; date: ISODate; earliest: ISODate; latest: ISODate | null; cmPerWeek: number };

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * When the touch trend reaches the dunk line: a least-squares line through the touch tests of the last
 * {@link FORECAST_WINDOW_DAYS} days, with the range its slope's 95% interval allows.
 */
export function forecastLine(touches: TouchResult[], line: number, today: ISODate): Forecast {
  const from = addDays(today, -FORECAST_WINDOW_DAYS);
  const recent = touches.filter((r) => r.date > from && r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const first = recent[0]?.date;
  if (recent.length < FORECAST_MIN_TESTS || daysBetween(first, recent.at(-1)!.date) < FORECAST_MIN_SPAN_DAYS) return { kind: 'few', tests: recent.length };

  const xs = recent.map((r) => daysBetween(first, r.date));
  const ys = recent.map((r) => r.value);
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  const now = daysBetween(first, today);
  if (my + slope * (now - mx) >= line) return { kind: 'reached' };
  const cmPerWeek = round1(slope * 7);
  if (slope <= 0) return { kind: 'flat', cmPerWeek };

  const sse = xs.reduce((s, x, i) => s + (ys[i] - (my + slope * (x - mx))) ** 2, 0);
  const margin = (T95[n - 3] ?? 1.96) * Math.sqrt(sse / (n - 2) / sxx);
  // First whole day on or past the crossing; the small allowance keeps an exact crossing on its own day.
  const day = (b: number) => addDays(first, Math.max(now, Math.ceil(mx + (line - my) / b - 1e-9)));
  return { kind: 'date', date: day(slope), earliest: day(slope + margin), latest: slope - margin > 0 ? day(slope - margin) : null, cmPerWeek };
}

export type GoalInput = {
  goalDate: ISODate | null;
  today: ISODate;
  forecast: Forecast;
  /** The diagnosis calls strength the limiter. */
  strengthLimited: boolean;
};

function forecastText(f: Forecast, goal: ISODate): string {
  switch (f.kind) {
    case 'few':
      return tr('近 6 周测满 {FORECAST_MIN_TESTS} 次摸高、跨 2 周以上才能预测哪天过线（现在 {tests} 次）', { FORECAST_MIN_TESTS, tests: f.tests });
    case 'reached':
      return tr('按近 6 周的趋势，已经摸到扣篮线');
    case 'flat':
      return tr('近 6 周摸高没有往上走（每周 {cmPerWeek} cm），按这个趋势预测不出过线日', { cmPerWeek: f.cmPerWeek });
    case 'date': {
      const late = daysBetween(goal, f.date);
      const range = tr('最早 {earliest}，{p}', { earliest: shortDate(f.earliest), p: f.latest ? tr('最晚 {latest}', { latest: shortDate(f.latest) }) : tr('最晚说不准') });
      return tr('预计 {date} 过线{p}（{range}）', { date: shortDate(f.date), p: late > 0 ? tr('，比目标日晚 {late} 天', { late }) : '', range });
    }
  }
}

/** The home screen's goal row: the countdown, the forecast, and what the goal does to training now. */
export function goalSummary({ goalDate, today, forecast, strengthLimited }: GoalInput): { title: string; lines: string[] } {
  if (!goalDate) return { title: tr('设一个扣篮目标日'), lines: [tr('计划会按它倒推：最后 {TAPER_DAYS} 天减量，当天测摸高、试扣', { TAPER_DAYS })] };
  const left = daysBetween(today, goalDate);
  if (left === 0) return { title: tr('今天是扣篮测试日'), lines: [tr('热身，测一次助跑摸高，再去篮下试扣，每试一次记一下')] };
  if (left < 0) return { title: tr('目标日 {goalDate} 已过 {left} 天', { goalDate: shortDate(goalDate), left: -left }), lines: [forecastText(forecast, goalDate)] };
  return {
    title: tr('目标日 {goalDate} · 还有 {left} 天', { goalDate: shortDate(goalDate), left }),
    lines: [
      forecastText(forecast, goalDate),
      ...(goalDay(goalDate, today) === 'taper' ? [tr('赛前减量：训练量减半，强度不变')] : []),
      ...(strengthLimited && defersStrength('strength', today, goalDate) ? [tr('力量还是短板，目标日后再练')] : []),
    ],
  };
}

const DATE_HINT = '日期写成 2026-12-01 这样';

/** The goal date as typed in 我的; empty clears it. */
export function parseGoalDate(text: string): { ok: true; date: ISODate | null } | { ok: false; problem: string } {
  const t = text.trim();
  if (!t) return { ok: true, date: null };
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return { ok: false, problem: tr(DATE_HINT) };
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // 2026-02-30 rolls over to March: not a real day.
  return addDays(date, 0) === date ? { ok: true, date } : { ok: false, problem: tr(DATE_HINT) };
}
