import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listAthletes, type Athlete } from '@/db/repo';

type AthleteContextValue = {
  athletes: Athlete[];
  current: Athlete | null;
  select: (id: number) => void;
  reload: () => Promise<void>;
};

const AthleteContext = createContext<AthleteContextValue | null>(null);

/** The athlete picked last on this phone, so a shared phone opens on whoever used it last, not on the first athlete. */
const CURRENT_KEY = 'current-athlete';

async function lastPicked(): Promise<number | null> {
  try {
    const v = await Storage.getItem(CURRENT_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/** Who is being tested. The design's "切换测试对象" switches this. */
export function AthleteProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setAthletes(await listAthletes(db));
  }, [db]);

  useEffect(() => {
    let alive = true;
    // Both before the first render with athletes, so the screens don't open on the first athlete and then jump.
    Promise.all([listAthletes(db), lastPicked()]).then(([rows, picked]) => {
      if (!alive) return;
      setCurrentId(picked);
      setAthletes(rows);
    });
    return () => {
      alive = false;
    };
  }, [db]);

  const select = useCallback((id: number) => {
    setCurrentId(id);
    Promise.resolve()
      .then(() => Storage.setItem(CURRENT_KEY, String(id)))
      .catch(() => {});
  }, []);

  const value = useMemo<AthleteContextValue>(() => {
    const current = athletes.find((a) => a.id === currentId) ?? athletes[0] ?? null;
    return { athletes, current, select, reload };
  }, [athletes, currentId, select, reload]);

  return <AthleteContext.Provider value={value}>{children}</AthleteContext.Provider>;
}

export function useAthlete(): AthleteContextValue {
  const ctx = useContext(AthleteContext);
  if (!ctx) throw new Error('useAthlete must be used inside AthleteProvider');
  return ctx;
}
