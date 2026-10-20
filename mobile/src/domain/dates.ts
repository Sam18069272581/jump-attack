/** A calendar day as `YYYY-MM-DD`. Training is planned by local day, not by instant. */
export type ISODate = string;

const DAY_MS = 24 * 60 * 60 * 1000;

function utc(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The local calendar day of an instant. */
export function toISODate(d: Date): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: ISODate, n: number): ISODate {
  return format(utc(date) + n * DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
export function weekday(date: ISODate): number {
  return ((new Date(utc(date)).getUTCDay() + 6) % 7) + 1;
}

export function mondayOf(date: ISODate): ISODate {
  return addDays(date, 1 - weekday(date));
}

export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

/** e.g. "10/20 周一". */
export function shortDate(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d} 周${WEEKDAY_NAMES[weekday(date) - 1]}`;
}
