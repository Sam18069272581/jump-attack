import type { SQLiteDatabase } from 'expo-sqlite';

import { exportBackup } from '@/db/backup';
import { ATHLETE_FORMAT, isPristine, retargetId, type AthleteFile, type BackupRow } from '@/domain/backup';
import { tr } from '@/i18n';

import type { Athlete } from './repo';

type Link = { table: string; from: string; to: string };
type Table = { name: string; links: Link[]; key: string | null; integerKey: boolean };

/** Every table with the tables it points at and its primary key, read from this database's own schema. */
async function schema(db: SQLiteDatabase): Promise<Table[]> {
  const names = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return Promise.all(
    names.map(async ({ name }) => {
      const links = await db.getAllAsync<Link>(`SELECT "table", "from", "to" FROM pragma_foreign_key_list('${name}')`);
      const keys = (await db.getAllAsync<{ name: string; type: string; pk: number }>(`PRAGMA table_info("${name}")`)).filter((c) => c.pk > 0);
      const key = keys.length === 1 ? keys[0] : null;
      return { name, links, key: key?.name ?? null, integerKey: key?.type.toUpperCase() === 'INTEGER' };
    }),
  );
}

/**
 * One athlete and every row that points at them, directly or through other rows (sessions → attempts, plans →
 * workouts → sets). Found by following the foreign keys, so tables added by later migrations come along by themselves.
 */
export async function exportAthlete(db: SQLiteDatabase, athleteId: number): Promise<AthleteFile> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const tables: Record<string, BackupRow[]> = { athlete: await db.getAllAsync<BackupRow>('SELECT * FROM athlete WHERE id = ?', athleteId) };
  const pending = (await schema(db)).filter((t) => t.name !== 'athlete');
  for (let found = true; found; ) {
    found = false;
    for (const t of pending.filter((t) => !tables[t.name])) {
      const link = t.links.find((l) => tables[l.table]);
      if (!link) continue;
      const parents = tables[link.table].map((r) => r[link.to ?? 'id']);
      const rows = parents.length ? await db.getAllAsync<BackupRow>(`SELECT * FROM "${t.name}" WHERE "${link.from}" IN (${parents.map(() => '?').join(', ')}) ORDER BY rowid`, parents) : [];
      tables[t.name] = rows;
      found = true;
    }
  }
  return { format: ATHLETE_FORMAT, schema_version: version?.user_version ?? 0, exported_at: new Date().toISOString(), tables };
}

/**
 * The athlete on this phone the file came from or went to before: added at the same moment (to the millisecond, and
 * copied unchanged by export, import and restore), whatever either phone renamed them to since.
 */
export async function findSameAthlete(db: SQLiteDatabase, file: AthleteFile): Promise<Athlete | null> {
  const a = file.tables.athlete[0];
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM athlete WHERE created_at = ? ORDER BY (name = ?) DESC, id LIMIT 1', a.created_at ?? '', a.name);
  return row && (await db.getFirstAsync<Athlete>('SELECT * FROM athlete WHERE id = ?', row.id));
}

export type AthleteImport = { ok: true; athleteId: number } | { ok: false; problem: string };

/**
 * Adds the athlete in the file next to the people on this phone, all or nothing. With `replace`, that athlete's records
 * give way to the file's (see findSameAthlete) and the athlete keeps their id. A phone that holds nothing yet (a new
 * install) loses its empty default athlete. Rows get new ids after this phone's, so nothing here is overwritten; table
 * and column names come from this database's schema, never from the file. Expects a file checked by parseAthleteFile.
 */
export async function importAthlete(db: SQLiteDatabase, file: AthleteFile, opts: { replace?: number } = {}): Promise<AthleteImport> {
  let athleteId = 0;
  try {
    const pristine = isPristine(await exportBackup(db));
    await db.withTransactionAsync(async () => {
      await db.execAsync('PRAGMA defer_foreign_keys = ON');
      if (opts.replace != null) await db.runAsync('DELETE FROM athlete WHERE id = ?', opts.replace);
      else if (pristine) await db.runAsync('DELETE FROM athlete');

      const tables = (await schema(db)).filter((t) => file.tables[t.name]?.length);
      // New ids for every row first, so links can be rewritten in any table order.
      const ids = new Map<string, Map<BackupValueKey, BackupValueKey>>();
      for (const t of tables) {
        const rows = file.tables[t.name];
        const map = new Map<BackupValueKey, BackupValueKey>();
        if (t.name === 'athlete' && opts.replace != null) map.set(rows[0].id as number, opts.replace);
        else if (t.integerKey && t.key) {
          // After both the highest id and the AUTOINCREMENT counter, which never hands out a deleted row's id again.
          const top = await db.getFirstAsync<{ n: number | null }>(`SELECT MAX(n) AS n FROM (SELECT MAX("${t.key}") AS n FROM "${t.name}" UNION ALL SELECT seq FROM sqlite_sequence WHERE name = ?)`, t.name);
          let next = (top?.n ?? 0) + 1;
          for (const r of [...rows].sort((a, b) => Number(a[t.key!]) - Number(b[t.key!]))) map.set(r[t.key!] as number, next++);
        }
        ids.set(t.name, map);
      }
      const athletes = (ids.get('athlete') ?? new Map()) as Map<number, number>;
      const workouts = (ids.get('workout') ?? new Map()) as Map<number, number>;
      for (const t of tables) {
        if (!t.key || t.integerKey) continue;
        const map = new Map<BackupValueKey, BackupValueKey>();
        for (const r of file.tables[t.name]) {
          const id = retargetId(String(r[t.key]), athletes, workouts);
          // A copy of an athlete already here under another name: their random session ids are taken.
          const taken = await db.getFirstAsync(`SELECT 1 FROM "${t.name}" WHERE "${t.key}" = ?`, id);
          map.set(r[t.key] as string, taken ? `${id}-${Math.random().toString(36).slice(2, 6)}` : id);
        }
        ids.set(t.name, map);
      }

      for (const t of tables) {
        const known = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info("${t.name}")`)).map((c) => c.name));
        for (const row of file.tables[t.name]) {
          const out: BackupRow = {};
          for (const [c, v] of Object.entries(row)) {
            if (!known.has(c)) continue;
            const link = c === t.key ? t.name : t.links.find((l) => l.from === c)?.table;
            const moved = link != null && v != null ? ids.get(link)?.get(v) : undefined;
            out[c] = moved ?? v;
          }
          const cols = Object.keys(out);
          await db.runAsync(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => out[c]));
        }
      }
      athleteId = athletes.get(file.tables.athlete[0].id as number) ?? 0;
    });
  } catch {
    return { ok: false, problem: tr('文件里的数据有问题，没有导入，手机上原来的数据保持不变。') };
  }
  return { ok: true, athleteId };
}

type BackupValueKey = string | number;
