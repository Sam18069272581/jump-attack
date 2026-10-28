/**
 * Calibrating touch heights measured from video. Standing reach + flight-time jump height assumes the hand leaves the
 * ground from standing-reach height, but at take-off the athlete is already on the toes with the arm up, and landing
 * posture changes the flight time, so the estimate is usually a few cm off what the hand really touches. A jump that
 * is both filmed and read off a wall or backboard gives that athlete's own gap; later video touches and the standing
 * estimate (standing reach + CMJ) add it, so all three kinds of touch sit on one scale.
 */
import { APPROACH_TOUCH } from './metrics';

export type Calibration = { touchedCm: number; reachCm: number; jumpCm: number };

/** Only the latest few: technique and the way the athlete lands change over time. */
export const MAX_CALIBRATIONS = 5;

/** Wall reading minus the video estimate, cm: the median of the latest calibrations, oldest first. Null without any. */
export function touchOffset(calibrations: Calibration[]): number | null {
  const gaps = calibrations
    .slice(-MAX_CALIBRATIONS)
    .map((c) => c.touchedCm - (c.reachCm + c.jumpCm))
    .sort((a, b) => a - b);
  if (gaps.length === 0) return null;
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(median * 10) / 10;
}

/** A wall reading this far from the video estimate is a different jump or a misread mark. */
export const MAX_CALIBRATION_GAP_CM = 25;

export function calibrationProblem(touchedCm: number, videoCm: number): string | null {
  const [lo, hi] = APPROACH_TOUCH.range!;
  if (touchedCm < lo || touchedCm > hi) return `摸高一般在 ${lo}–${hi} cm，检查一下刻度`;
  const gap = Math.abs(touchedCm - videoCm);
  if (gap > MAX_CALIBRATION_GAP_CM) return `和录像算出的 ${videoCm.toFixed(1)} cm 差了 ${Math.round(gap)} cm，不像同一跳，检查一下刻度`;
  return null;
}
