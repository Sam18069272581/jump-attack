import { toISODate } from './dates';

import { localized, tr } from '@/i18n';

/**
 * A copy of the whole local database, for moving to another phone, another computer's Expo Go or the
 * cloud. Rows are kept as stored (ids included) so the links between tables survive a restore. Every
 * table is included, so tables added by later migrations need nothing here.
 */
export const BACKUP_FORMAT = 'jump-attack-backup';

/**
 * One athlete and everything recorded for them, in the same shape as a backup, for handing a teammate their own data
 * or bringing it to another phone. Imported next to the people already there, never in place of them.
 */
export const ATHLETE_FORMAT = 'jump-attack-athlete';

export type BackupValue = string | number | null;
export type BackupRow = Record<string, BackupValue>;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  /** The migration count of the database it came from (`PRAGMA user_version`). */
  schema_version: number;
  exported_at: string;
  /** By table name. A table missing here (an older backup) restores as empty. */
  tables: Record<string, BackupRow[]>;
};

export type BackupParse = { ok: true; backup: Backup } | { ok: false; problem: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isValue = (v: unknown) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/** How a file's problems name it: a whole backup to restore, or one athlete's data to import. */
const WORDS = localized({
  [BACKUP_FORMAT]: { notOurs: '这不是 Jump Attack 的备份文件。', newer: '这份备份来自更新版本的 App，先更新 App 再恢复。', broken: '备份文件里的' },
  [ATHLETE_FORMAT]: { notOurs: '这不是 Jump Attack 的运动员数据文件。', newer: '这份文件来自更新版本的 App，先更新 App 再导入。', broken: '文件里的' },
});

/** The tables of a file in `format`, checked row by row, or what is wrong with it. */
function readTables(
  text: string,
  format: typeof BACKUP_FORMAT | typeof ATHLETE_FORMAT,
  latestVersion: number,
): { ok: true; schema_version: number; exported_at: string; tables: Backup['tables'] } | { ok: false; problem: string; format?: unknown } {
  const words = WORDS[format];
  const notOurs = { ok: false, problem: words.notOurs } as const;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return notOurs;
  }
  if (!isObject(data)) return notOurs;
  if (data.format !== format) return { ...notOurs, format: data.format };
  if (!Number.isInteger(data.schema_version) || !isObject(data.tables)) return notOurs;
  // A newer app's columns are unknown here and would be silently dropped.
  if ((data.schema_version as number) > latestVersion) return { ok: false, problem: words.newer };

  const tables = data.tables;
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || !rows.every((r) => isObject(r) && Object.values(r).every(isValue))) return { ok: false, problem: tr('{broken} {name} 有损坏的记录。', { broken: words.broken, name }) };
  }
  return { ok: true, schema_version: data.schema_version as number, exported_at: typeof data.exported_at === 'string' ? data.exported_at : '', tables: tables as Backup['tables'] };
}

/** Reads a backup file's text, or a backup downloaded from the cloud. `latestVersion` is the schema this app migrates to. */
export function parseBackup(text: string, latestVersion: number): BackupParse {
  const read = readTables(text, BACKUP_FORMAT, latestVersion);
  if (!read.ok) {
    // Restoring one athlete's file would replace everyone else on the phone with that one athlete.
    return read.format === ATHLETE_FORMAT ? { ok: false, problem: tr('这是单个运动员的数据文件，请在「我的 → 测试对象」里用「导入运动员」。') } : { ok: false, problem: read.problem };
  }
  if (!Array.isArray(read.tables.athlete) || read.tables.athlete.length === 0) return { ok: false, problem: tr('备份里没有测试对象。') };
  return { ok: true, backup: { format: BACKUP_FORMAT, schema_version: read.schema_version, exported_at: read.exported_at, tables: read.tables } };
}

export type AthleteFile = Omit<Backup, 'format'> & { format: typeof ATHLETE_FORMAT };

export function parseAthleteFile(text: string, latestVersion: number): { ok: true; file: AthleteFile } | { ok: false; problem: string } {
  const read = readTables(text, ATHLETE_FORMAT, latestVersion);
  if (!read.ok) return { ok: false, problem: read.format === BACKUP_FORMAT ? tr('这是整台手机的备份文件，请用「从备份文件恢复」。') : read.problem };
  if (read.tables.athlete?.length !== 1) return { ok: false, problem: tr('文件里应该正好有一个运动员。') };
  return { ok: true, file: { format: ATHLETE_FORMAT, schema_version: read.schema_version, exported_at: read.exported_at, tables: read.tables } };
}

export function athleteFileName(name: string, now: Date): string {
  return `jump-attack-${name.replace(/[\\/:*?"<>|]/g, '_')}-${toISODate(now)}.json`;
}

/**
 * Session ids that name the row they belong to (db/bodyMass.ts and db/recovery.ts: day-<athlete>-…; the warm-up bar
 * speed in workout/[date].tsx: warmup-<workout>-…), moved to the ids those rows get on import. Others stay as they are.
 */
export function retargetId(id: string, athletes: Map<number, number>, workouts: Map<number, number>): string {
  const m = /^(day|warmup)-(\d+)-(.*)$/.exec(id);
  const to = m && (m[1] === 'day' ? athletes : workouts).get(Number(m[2]));
  return to != null ? `${m![1]}-${to}-${m![3]}` : id;
}

const count = (b: Pick<Backup, 'tables'>, table: string) => b.tables[table]?.length ?? 0;

/** What a backup holds, in the terms the app uses, for the confirmation before replacing data. */
export function describeBackup(b: Pick<Backup, 'tables'>): string {
  return tr('{b} 个测试对象、{b2} 次测试、{b3} 次训练', { b: count(b, 'athlete'), b2: count(b, 'test_session'), b3: count(b, 'workout') });
}

export function backupFileName(now: Date): string {
  return `jump-attack-backup-${toISODate(now)}.json`;
}

/**
 * A fingerprint of the data alone, to tell whether a device or the cloud changed since the last sync.
 * Leaves out the export time, empty tables and column order (Postgres jsonb reorders keys).
 * cyrb53 (bryc, public domain): a 53-bit string hash, plenty to tell versions of one person's data apart.
 */
export function backupHash(b: Backup): string {
  const canonical = Object.keys(b.tables)
    .filter((t) => b.tables[t].length > 0)
    .sort()
    .map((t) => [t, b.tables[t].map((row) => Object.keys(row).sort().map((c) => [c, row[c]]))]);
  const s = JSON.stringify(canonical);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The athlete the first migration creates. */
// i18n-ignore: the name migration 1 stores, compared, never shown from here.
const DEFAULT_ATHLETE = '我自己';
const ATHLETE_KEYS = new Set(['id', 'name', 'created_at']);

/** Whether the data is what a fresh install starts with: one untouched default athlete and nothing recorded. */
export function isPristine(b: Backup): boolean {
  const athletes = b.tables.athlete ?? [];
  const untouched = athletes.length <= 1 && athletes.every((a) => a.name === DEFAULT_ATHLETE && Object.entries(a).every(([k, v]) => ATHLETE_KEYS.has(k) || v === null));
  return untouched && Object.entries(b.tables).every(([t, rows]) => t === 'athlete' || rows.length === 0);
}
