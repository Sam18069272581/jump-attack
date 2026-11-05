import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { dateTime } from '@/domain/dates';
import { tr } from '@/i18n';
import { authProblem, getSupabase } from '@/sync/client';
import { supabaseBackups } from '@/sync/cloud';
import { forgetAccount, syncWithCloud, type SyncChoice, type SyncOutcome } from '@/sync/sync';

type Conflict = Extract<SyncOutcome, { kind: 'conflict' }>;
type Confirm = Extract<SyncOutcome, { kind: 'confirm' }>;
/** How a restore went (db/backup.ts). */
type Replaced = { ok: true } | { ok: false; problem: string };

type SyncContextValue = {
  /** Whether a Supabase project is set up in sync/config.ts. */
  configured: boolean;
  email: string | null;
  busy: boolean;
  /** What the last sync did, in words. */
  status: string | null;
  conflict: Conflict | null;
  /** The phone was last synced with another account and this one has nothing in the cloud: back it up here? */
  confirm: Confirm | null;
  /** Each resolves to a problem to show, or null. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  syncNow: (choice?: SyncChoice) => Promise<void>;
  /**
   * Runs a restore once the sync that is running is done, and no sync while it runs: one would read the data half
   * replaced, or download over it. Call dataReplaced after it. `ownerUnknown`: what it puts back may be another
   * account's (undoing a restore on a shared phone). `asks`: the next sync then asks before backing it up.
   */
  replaceData: (restore: () => Promise<Replaced>, ownerUnknown?: boolean) => Promise<Replaced & { asks: boolean }>;
  /** Call after the database was replaced (a restore), so every screen reads it again. */
  dataReplaced: () => Promise<void>;
  /** Counts restores; everything inside the provider is remounted when it changes. */
  epoch: number;
};

const SyncContext = createContext<SyncContextValue | null>(null);

const device = () => (Platform.OS === 'web' ? tr('网页') : Platform.OS === 'ios' ? 'iPhone' : 'Android');

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
  // What the person has to answer before the next sync can go on: which side to keep, or whether to back up here.
  const [question, setQuestion] = useState<Conflict | Confirm | null>(null);
  const [epoch, setEpoch] = useState(0);
  // A sync, or a restore from the backup page: one at a time.
  const running = useRef<Promise<unknown> | null>(null);
  const asked = useRef(false);
  const userId = session?.user.id ?? null;

  const dataReplaced = useCallback(async () => {
    setEpoch((e) => e + 1);
  }, []);

  /** One sync for an account; skipped while another is running. */
  const run = useCallback(
    async (userId: string, choice?: SyncChoice) => {
      if (!supabase || running.current) return;
      const sync = syncWithCloud(db, supabaseBackups(supabase, userId), Storage, userId, device(), choice);
      running.current = sync;
      setBusy(true);
      const outcome = await sync.finally(() => {
        running.current = null;
        setBusy(false);
      });
      const now = dateTime(new Date().toISOString());
      if (outcome.kind === 'conflict' || outcome.kind === 'confirm') {
        setStatus(outcome.kind === 'conflict' ? tr('手机和云端的数据不一样，选一份保留') : tr('手机上的数据之前同步到另一个账号，确认后才会备份到这个账号'));
        // Answered, and asked again: the phone's data changed since the question (sync/sync.ts). It is a new one.
        if (choice) asked.current = false;
        setQuestion(outcome);
        return;
      }
      setQuestion(null);
      setStatus(outcome.kind === 'failed' ? outcome.problem : `${tr(STATUS[outcome.kind])} · ${now}`);
      if (outcome.kind === 'downloaded') await dataReplaced();
    },
    [db, supabase, dataReplaced],
  );

  const replaceData = useCallback(async (restore: () => Promise<Replaced>, ownerUnknown = false) => {
    while (running.current) await running.current.catch(() => {});
    const replacing = (async (): Promise<Replaced & { asks: boolean }> => {
      try {
        // Before anything changes: if the app is closed halfway, the next sync still asks.
        const asks = ownerUnknown && (await forgetAccount(Storage));
        return { ...(await restore()), asks };
      } catch (e) {
        return { ok: false, problem: e instanceof Error ? e.message : String(e), asks: false };
      }
    })();
    running.current = replacing;
    setBusy(true);
    const replaced = await replacing.finally(() => {
      running.current = null;
      setBusy(false);
    });
    if (replaced.ok) {
      // A question still open, and the last sync's word, were about the data replaced.
      setQuestion(null);
      setStatus(null);
    }
    return replaced;
  }, []);

  const syncNow = useCallback(
    async (choice?: SyncChoice) => {
      if (userId) await run(userId, choice);
    },
    [userId, run],
  );

  // Ask once per question, not again on every app switch while it stays open.
  useEffect(() => {
    if (!question) asked.current = false;
    else if (!asked.current) {
      asked.current = true;
      const choose = (c: SyncChoice) => void syncNow(c);
      if (question.kind === 'conflict') askWhichToKeep(question, choose);
      else askToBackUpHere(question, choose);
    }
  }, [question, syncNow]);

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
      conflict: question?.kind === 'conflict' ? question : null,
      confirm: question?.kind === 'confirm' ? question : null,
      signIn: (email, password) => auth('signInWithPassword', email, password),
      signUp: (email, password) => auth('signUp', email, password),
      signOut: async () => {
        await supabase?.auth.signOut();
        setStatus(null);
        setQuestion(null);
      },
      syncNow,
      replaceData,
      dataReplaced,
      epoch,
    };
  }, [supabase, session, busy, status, question, syncNow, replaceData, dataReplaced, epoch]);

  return (
    <SyncContext.Provider value={value}>
      <Fragment key={epoch}>{children}</Fragment>
    </SyncContext.Provider>
  );
}

export function askWhichToKeep(c: Conflict, choose: (choice: SyncChoice) => void) {
  Alert.alert(
    tr('手机和云端的数据不一样'),
    tr('手机上：{phone}\n云端（{p}）：{cloud}\n\n选一份保留，另一份会被它替换。云端以前每天的备份都还在。', { phone: c.phone, p: c.cloudAt ? dateTime(c.cloudAt) : tr('较早'), cloud: c.cloud }),
    [
      { text: tr('以后再说'), style: 'cancel' },
      { text: tr('用手机上的'), onPress: () => choose('phone') },
      { text: tr('用云端的'), onPress: () => choose('cloud') },
    ],
  );
}

/** On a shared phone: whoever signs in gets the data on it backed up into their account only if they say so. */
export function askToBackUpHere(c: Confirm, choose: (choice: SyncChoice) => void) {
  Alert.alert(
    tr('这台手机上的数据之前同步到另一个账号'),
    tr('手机上：{phone}\n\n现在登录的账号在云端还没有备份。要把这些数据备份到这个账号吗？这不是你的手机的话，选「以后再说」，再退出登录。', { phone: c.phone }),
    [
      { text: tr('以后再说'), style: 'cancel' },
      { text: tr('备份到这个账号'), onPress: () => choose('phone') },
    ],
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
