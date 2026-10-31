// Minimal stand-in for expo-sqlite's async API on top of Node's built-in SQLite, so SQL can be tested in Jest.
import type { SQLiteDatabase } from 'expo-sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

type Params = unknown[];

function flatten(args: unknown[]): Params {
  return args.length === 1 && Array.isArray(args[0]) ? (args[0] as Params) : args;
}

export function openMemoryDb(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const api = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, ...args: unknown[]) {
      const r = db.prepare(sql).run(...flatten(args));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync(sql: string, ...args: unknown[]) {
      return db.prepare(sql).all(...flatten(args)).map((row: object) => ({ ...row }));
    },
    async getFirstAsync(sql: string, ...args: unknown[]) {
      const row = db.prepare(sql).get(...flatten(args));
      return row ? { ...row } : null;
    },
    async isInTransactionAsync() {
      return db.isTransaction as boolean;
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}
