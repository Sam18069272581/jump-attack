import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

import { cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from './config';

import { tr } from '@/i18n';

let client: SupabaseClient | null = null;

/** The app's Supabase client, or null until config.ts is filled in. The sign-in is kept in kv-store. */
export function getSupabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: Storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

/** Supabase's English auth errors, in the words the rest of the app uses. */
export function authProblem(message: string): string {
  if (/invalid login credentials/i.test(message)) return tr('邮箱或密码不对。');
  if (/already registered|already exists/i.test(message)) return tr('这个邮箱已经注册过了，直接登录。');
  if (/password.*(at least|short|characters)/i.test(message)) return tr('密码至少 6 位。');
  if (/email.*not confirmed/i.test(message)) return tr('邮箱还没确认：去邮箱点一下确认链接，再回来登录。');
  if (/valid email|invalid.*email/i.test(message)) return tr('邮箱格式不对。');
  if (/rate limit|too many/i.test(message)) return tr('尝试太频繁，过几分钟再试。');
  if (/network|fetch/i.test(message)) return tr('连不上云端，检查网络后再试。');
  return tr('登录失败：{message}', { message });
}
