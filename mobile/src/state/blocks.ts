import type { SQLiteDatabase } from 'expo-sqlite';

import { loadDiagnosis } from '@/db/dunk';
import { listMetricResults, listSessionResults, type Athlete } from '@/db/repo';
import { getWorkout, setBlocks } from '@/db/training';
import { acceptSuggestion, advanceSuggestion, declineSuggestion, switchSuggestion, type BlockSuggestion, type TouchResult } from '@/domain/blocks';
import { addDays, toISODate, type ISODate } from '@/domain/dates';
import type { DunkDiagnosis } from '@/domain/dunk';
import { APPROACH_TOUCH } from '@/domain/metrics';

import type { TrainingData } from './training';

/**
 * Touch heights to judge progress by: the approach-touch test once the athlete has done it, otherwise standing
 * reach + each CMJ, so the series stays one kind of jump.
 */
export async function touchHistory(db: SQLiteDatabase, athlete: Athlete): Promise<TouchResult[]> {
  const day = (r: { started_at: string }) => toISODate(new Date(r.started_at));
  const approach = await listMetricResults(db, athlete.id, APPROACH_TOUCH);
  if (approach.length) return approach.map((r) => ({ date: day(r), value: r.best }));
  const reach = athlete.standing_reach_cm;
  if (reach == null) return [];
  return (await listSessionResults(db, athlete.id, 'cmj')).map((r) => ({ date: day(r), value: reach + r.best }));
}

export type BlockAdvice = { diagnosis: DunkDiagnosis | null; suggestion: BlockSuggestion | null };

/** For a block plan: the current diagnosis and the one suggestion to show, switching blocks before skipping ahead. */
export async function loadBlockAdvice(db: SQLiteDatabase, athlete: Athlete, data: TrainingData, today: ISODate): Promise<BlockAdvice> {
  if (!data.template.blocks || !data.plan.blocks?.length) return { diagnosis: null, suggestion: null };
  const [diagnosis, touches] = await Promise.all([loadDiagnosis(db, athlete), touchHistory(db, athlete)]);
  const suggestion = switchSuggestion(data.template, data.plan, today, diagnosis) ?? advanceSuggestion(data.template, data.plan, today, touches);
  return { diagnosis, suggestion };
}

/** Accepts a suggestion. Skipping ahead starts today, or tomorrow when today's workout has already begun. */
export async function acceptBlockSuggestion(db: SQLiteDatabase, data: TrainingData, s: BlockSuggestion, d: DunkDiagnosis | null, today: ISODate): Promise<void> {
  const from = s.kind === 'advance' && (await getWorkout(db, data.plan.id, today)) ? addDays(today, 1) : today;
  await setBlocks(db, data.plan.id, acceptSuggestion(data.plan, s, d, from));
}

export async function declineBlockSuggestion(db: SQLiteDatabase, data: TrainingData, s: BlockSuggestion, today: ISODate): Promise<void> {
  await setBlocks(db, data.plan.id, declineSuggestion(data.plan, s, today));
}
