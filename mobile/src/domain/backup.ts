import { toISODate } from './dates';

/**
 * A copy of the whole local database, for moving to another phone, another computer's Expo Go or the
 * cloud. Rows are kept as stored (ids included) so the links between tables survive a restore. Every
 * table is included, so tables added by later migrations need nothing here.
 */
export const BACKUP_FORMAT = 'jump-attack-backup';

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

/** Reads a backup file's text, or a backup downloaded from the cloud. `latestVersion` is the schema this app migrates to. */
export function parseBackup(text: string, latestVersion: number): BackupParse {
  const notOurs = { ok: false, problem: '这不是 Jump Attack 的备份文件。' } as const;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return notOurs;
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT || !Number.isInteger(data.schema_version) || !isObject(data.tables)) return notOurs;
  // A newer app's columns are unknown here and would be silently dropped.
  if ((data.schema_version as number) > latestVersion) return { ok: false, problem: '这份备份来自更新版本的 App，先更新 App 再恢复。' };

  const tables = data.tables;
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || !rows.every((r) => isObject(r) && Object.values(r).every(isValue))) return { ok: false, problem: `备份文件里的 ${name} 有损坏的记录。` };
  }
  if (!Array.isArray(tables.athlete) || tables.athlete.length === 0) return { ok: false, problem: '备份里没有测试对象。' };

  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      schema_version: data.schema_version as number,
      exported_at: typeof data.exported_at === 'string' ? data.exported_at : '',
      tables: tables as Backup['tables'],
    },
  };
}

const count = (b: Backup, table: string) => b.tables[table]?.length ?? 0;

/** What a backup holds, in the terms the app uses, for the confirmation before replacing data. */
export function describeBackup(b: Backup): string {
  return `${count(b, 'athlete')} 个测试对象、${count(b, 'test_session')} 次测试、${count(b, 'workout')} 次训练`;
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
const DEFAULT_ATHLETE = '我自己';
const ATHLETE_KEYS = new Set(['id', 'name', 'created_at']);

/** Whether the data is what a fresh install starts with: one untouched default athlete and nothing recorded. */
export function isPristine(b: Backup): boolean {
  const athletes = b.tables.athlete ?? [];
  const untouched = athletes.length <= 1 && athletes.every((a) => a.name === DEFAULT_ATHLETE && Object.entries(a).every(([k, v]) => ATHLETE_KEYS.has(k) || v === null));
  return untouched && Object.entries(b.tables).every(([t, rows]) => t === 'athlete' || rows.length === 0);
}
