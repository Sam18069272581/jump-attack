import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listAthletes, type Athlete } from '@/db/repo';

type AthleteContextValue = {
  athletes: Athlete[];
  current: Athlete | null;
  select: (id: number) => void;
  reload: () => Promise<void>;
};

const AthleteContext = createContext<AthleteContextValue | null>(null);

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
    listAthletes(db).then((rows) => alive && setAthletes(rows));
    return () => {
      alive = false;
    };
  }, [db]);

  const value = useMemo<AthleteContextValue>(() => {
    const current = athletes.find((a) => a.id === currentId) ?? athletes[0] ?? null;
    return { athletes, current, select: setCurrentId, reload };
  }, [athletes, currentId, reload]);

  return <AthleteContext.Provider value={value}>{children}</AthleteContext.Provider>;
}

export function useAthlete(): AthleteContextValue {
  const ctx = useContext(AthleteContext);
  if (!ctx) throw new Error('useAthlete must be used inside AthleteProvider');
  return ctx;
}
