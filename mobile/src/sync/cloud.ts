import type { SupabaseClient } from '@supabase/supabase-js';

import type { Backup } from '@/domain/backup';
import type { ISODate } from '@/domain/dates';

export type CloudMeta = { hash: string; updatedAt: string; device: string };

/** The signed-in person's backups in the cloud: one row per day, the newest is what sync compares with. */
export interface CloudBackups {
  latest(): Promise<CloudMeta | null>;
  /** The newest backup's data, as stored (checked by parseBackup before use). */
  download(): Promise<{ data: unknown; hash: string } | null>;
  upload(b: { backup: Backup; hash: string; device: string; date: ISODate }): Promise<void>;
}

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function supabaseBackups(client: SupabaseClient, userId: string): CloudBackups {
  const newest = (columns: string) => client.from('backups').select(columns).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return {
    async latest() {
      const row = check(await newest('hash, updated_at, device')) as { hash: string; updated_at: string; device: string } | null;
      return row && { hash: row.hash, updatedAt: row.updated_at, device: row.device };
    },
    async download() {
      return check(await newest('data, hash')) as { data: unknown; hash: string } | null;
    },
    async upload({ backup, hash, device, date }) {
      check(
        await client
          .from('backups')
          .upsert(
            { user_id: userId, backup_date: date, updated_at: new Date().toISOString(), device, schema_version: backup.schema_version, hash, data: backup },
            { onConflict: 'user_id,backup_date' },
          ),
      );
    },
  };
}
