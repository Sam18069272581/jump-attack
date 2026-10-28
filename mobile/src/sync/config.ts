/**
 * The person's own Supabase project (see supabase/backups.sql). The publishable (anon) key is meant to
 * ship inside apps: row-level security on the backups table is what keeps each account's data private.
 * Left empty, the app runs as before and only offers backup files.
 */
export const SUPABASE_URL: string = 'https://yegllbhyqrkdhzduqnew.supabase.co';
export const SUPABASE_KEY: string = 'sb_publishable_E9xmuSJRke4IA_4tiPbXng_uiv3dYWL';

export const cloudConfigured = SUPABASE_URL !== '' && SUPABASE_KEY !== '';
