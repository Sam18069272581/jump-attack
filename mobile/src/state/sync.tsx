import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { toISODate } from '@/domain/dates';
import { tr } from '@/i18n';
import { authProblem, getSupabase } from '@/sync/client';
import { supabaseBackups } from '@/sync/cloud';
import { syncWithCloud, type SyncChoice, type SyncOutcome } from '@/sync/sync';

type Conflict = Extract<SyncOutcome, { kind: 'conflict' }>;

type SyncContextValue = {
  /** Whether a Supabase project is set up in sync/config.ts. */
  configured: boolean;
  email: string | null;
  busy: boolean;
  /** What the last sync did, in words. */
  status: string | null;
  conflict: Conflict | null;
  /** Each resolves to a problem to show, or null. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  syncNow: (choice?: SyncChoice) => Promise<void>;
  /** Call after the database was replaced (a restore), so every screen reads it again. */
  dataReplaced: () => Promise<void>;
  /** Counts restores; everything inside the provider is remounted when it changes. */
  epoch: number;
};

const SyncContext = createContext<SyncContextValue | null>(null);

const device = () => (Platform.OS === 'web' ? tr('网页') : Platform.OS === 'ios' ? 'iPhone' : 'Android');

function clock(iso: string): string {
  const d = new Date(iso);
  return `${toISODate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STATUS: Record<'nothing' | 'uploaded' | 'downloaded', string> = { nothing: '已是最新', uploaded: '已备份到云端', downloaded: '已从云端恢复' };

/**
 * Signs in to the person's Supabase account and keeps the local database backed up there: on sign-in,
 * when the app opens and when it goes to the background. Does nothing until sync/config.ts is filled in.
 * After a restore it remounts its children (athletes, navigator, screens) so nothing shows stale data.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [epoch, setEpoch] = useState(0);
  const running = useRef(false);
  const asked = useRef(false);
  const userId = session?.user.id ?? null;

  const dataReplaced = useCallback(async () => {
    setEpoch((e) => e + 1);
  }, []);

  /** One sync for an account; skipped while another is running. */
  const run = useCallback(
    async (userId: string, choice?: SyncChoice) => {
      if (!supabase || running.current) return;
      running.current = true;
      setBusy(true);
      const outcome = await syncWithCloud(db, supabaseBackups(supabase, userId), Storage, userId, device(), choice);
      running.current = false;
      setBusy(false);
      const now = clock(new Date().toISOString());
      if (outcome.kind === 'conflict') {
        setStatus(tr('手机和云端的数据不一样，选一份保留'));
        setConflict(outcome);
        return;
      }
      setConflict(null);
      setStatus(outcome.kind === 'failed' ? outcome.problem : `${tr(STATUS[outcome.kind])} · ${now}`);
      if (outcome.kind === 'downloaded') await dataReplaced();
    },
    [db, supabase, dataReplaced],
  );

  const syncNow = useCallback(
    async (choice?: SyncChoice) => {
      if (userId) await run(userId, choice);
    },
    [userId, run],
  );

  // Ask once per conflict, not again on every app switch while it stays open.
  useEffect(() => {
    if (!conflict) asked.current = false;
    else if (!asked.current) {
      asked.current = true;
      askWhichToKeep(conflict, (c) => void syncNow(c));
    }
  }, [conflict, syncNow]);

  // Fires with the stored session when the app opens, and on every sign-in: both start a sync.
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Deferred: Supabase calls made inside this callback wait on the auth lock it holds.
      if (s && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) setTimeout(() => void run(s.user.id), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, run]);

  useEffect(() => {
    if (!supabase) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        void syncNow();
      } else {
        supabase.auth.stopAutoRefresh();
        if (state === 'background') void syncNow();
      }
    });
    return () => sub.remove();
  }, [supabase, syncNow]);

  const value = useMemo<SyncContextValue>(() => {
    const auth = async (fn: 'signInWithPassword' | 'signUp', email: string, password: string) => {
      if (!supabase) return tr('云端还没设置好。');
      try {
        const { data, error } = await supabase.auth[fn]({ email: email.trim(), password });
        if (error) return authProblem(error.message);
        if (!data.session) return tr('注册好了，去邮箱点一下确认链接，再回来登录。');
        return null;
      } catch (e) {
        return authProblem(e instanceof Error ? e.message : String(e));
      }
    };
    return {
      configured: supabase != null,
      email: session?.user.email ?? null,
      busy,
      status,
      conflict,
      signIn: (email, password) => auth('signInWithPassword', email, password),
      signUp: (email, password) => auth('signUp', email, password),
      signOut: async () => {
        await supabase?.auth.signOut();
        setStatus(null);
        setConflict(null);
      },
      syncNow,
      dataReplaced,
      epoch,
    };
  }, [supabase, session, busy, status, conflict, syncNow, dataReplaced, epoch]);

  return (
    <SyncContext.Provider value={value}>
      <Fragment key={epoch}>{children}</Fragment>
    </SyncContext.Provider>
  );
}

export function askWhichToKeep(c: Conflict, choose: (choice: SyncChoice) => void) {
  Alert.alert(
    tr('手机和云端的数据不一样'),
    tr('手机上：{phone}\n云端（{p}）：{cloud}\n\n选一份保留，另一份会被它替换。云端以前每天的备份都还在。', { phone: c.phone, p: c.cloudAt ? clock(c.cloudAt) : tr('较早'), cloud: c.cloud }),
    [
      { text: tr('以后再说'), style: 'cancel' },
      { text: tr('用手机上的'), onPress: () => choose('phone') },
      { text: tr('用云端的'), onPress: () => choose('cloud') },
    ],
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
