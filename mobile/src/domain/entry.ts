import type { MetricDef } from './metrics';

/** A typed number, accepting a decimal comma; null when blank or not a number. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Why a typed value can't be right for this metric, or null when it looks plausible. */
export function manualProblem(def: MetricDef, value: number): string | null {
  const [min, max] = def.range ?? [0, Infinity];
  if (value < min || value > max || (!def.range && value <= 0)) {
    const span = def.range ? `${def.range.map((x) => +x.toFixed(def.decimals)).join('–')} ${def.unit}` : `大于 0`;
    return `${def.name}一般在 ${span}，检查一下输入`;
  }
  return null;
}
