import type { SQLiteDatabase } from 'expo-sqlite';

import { BACKUP_FORMAT, fitsColumn, isPristine, parseBackup, type Backup, type BackupRow } from '@/domain/backup';
import { tr } from '@/i18n';

import { LATEST_VERSION } from './migrations';

/** Where restoreBackup keeps what it replaced (migration 13). Not the person's data: it never leaves this phone. */
const KEPT = 'restore_undo';

/** The tables that hold the person's data: all but SQLite's own and the copy kept for taking a restore back. */
export async function dataTables(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ? ORDER BY name", KEPT);
  return rows.map((r) => r.name);
}

/** Each column of a table this database has, with its declared type (checked with fitsColumn before a file's values go in). */
export async function columnTypes(db: SQLiteDatabase, table: string): Promise<Map<string, string>> {
  return new Map((await db.getAllAsync<{ name: string; type: string }>(`PRAGMA table_info("${table}")`)).map((c) => [c.name, c.type]));
}

/** Every table, as stored. */
export async function exportBackup(db: SQLiteDatabase): Promise<Backup> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const tables: Backup['tables'] = {};
  for (const name of await dataTables(db)) tables[name] = await db.getAllAsync<BackupRow>(`SELECT * FROM "${name}" ORDER BY rowid`);
  return { format: BACKUP_FORMAT, schema_version: version?.user_version ?? 0, exported_at: new Date().toISOString(), tables };
}

/**
 * Replaces everything on this device with the backup, all or nothing. Expects a backup checked by
 * parseBackup. Table and column names come from this database's schema, never from the backup.
 * Foreign keys are checked at commit, so tables can be filled in any order. What the phone held is kept
 * (see undoRestore), unless it held nothing yet.
 */
export async function restoreBackup(db: SQLiteDatabase, backup: Backup): Promise<{ ok: true } | { ok: false; problem: string }> {
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync('PRAGMA defer_foreign_keys = ON');
      // A sync downloads by itself when only the cloud changed, so a wrong backup there (from a device with a wrong
      // clock, or an older app) would replace what was just recorded here. Kept, it can be put back.
      const current = await exportBackup(db);
      if (!isPristine(current)) await db.runAsync(`INSERT OR REPLACE INTO ${KEPT} (id, at, data) VALUES (1, ?, ?)`, new Date().toISOString(), JSON.stringify(current));
      const names = await dataTables(db);
      for (const name of names) await db.runAsync(`DELETE FROM "${name}"`);
      for (const name of names) {
        const rows = backup.tables[name];
        if (!rows?.length) continue;
        const types = await columnTypes(db, name);
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => types.has(c));
          if (cols.some((c) => !fitsColumn(types.get(c)!, row[c]))) throw new Error(`${name}: a value of the wrong type`);
          await db.runAsync(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
        }
      }
    });
  } catch {
    return { ok: false, problem: tr('备份里的数据有问题，没有恢复，手机上原来的数据保持不变。') };
  }
  return { ok: true };
}

/** What the last restore replaced, if the phone kept it (it keeps nothing from a phone that held nothing yet). */
export async function keptBeforeRestore(db: SQLiteDatabase): Promise<{ at: string; backup: Backup } | null> {
  const row = await db.getFirstAsync<{ at: string; data: string }>(`SELECT at, data FROM ${KEPT} WHERE id = 1`);
  if (!row) return null;
  const parsed = parseBackup(row.data, LATEST_VERSION);
  return parsed.ok ? { at: row.at, backup: parsed.backup } : null;
}

/** Puts back what the last restore replaced. What this replaces is kept in turn, so it can be swapped back again. */
export async function undoRestore(db: SQLiteDatabase): Promise<{ ok: true } | { ok: false; problem: string }> {
  const kept = await keptBeforeRestore(db);
  if (!kept) return { ok: false, problem: tr('没有可以换回的数据。') };
  return restoreBackup(db, kept.backup);
}
