"""
The phase definitions every number in this harness is measured against: the ground truth of the synthetic videos
and the reference analyser both call `concentric_phases`, so a disagreement is a measurement error, never two
different ideas of where a rep starts.

- Concentric phase: the bar's vertical velocity goes from <= 0 to > 0 (start) and back to <= 0 (end). Both ends are
  interpolated between samples. A rise that sags at a sticking point and rises again is one rep, not two.
- ROM: vertical rise of the bar between those two instants, m.
- MCV (mean concentric velocity): ROM / duration of the concentric phase.
- Propulsive phase (Sanchez-Medina et al. 2010): from the concentric start to the first instant after peak velocity
  where the bar decelerates faster than gravity (a < -9.81 m/s²); the whole concentric phase if it never does.
- MPV (mean propulsive velocity): rise during the propulsive phase / its duration.
- PV (peak velocity): the largest vertical velocity within the concentric phase.
"""
from __future__ import annotations

import numpy as np

G = 9.81
#: A rise shorter than this (m) is a walk-out, re-rack or wobble, not a rep.
MIN_ROM_M = 0.10
#: And shorter than this share of the record's longest rise.
MIN_ROM_SHARE = 0.5
#: Two rises this close in time (s)…
MERGE_GAP_S = 0.35
#: …with the bar sinking less than this share of the first rise in between are one grinding rep…
MERGE_DROP_SHARE = 0.25
#: …as long as both parts rise at least this far (m): jitter at the bottom or top is not part of a rep.
MERGE_MIN_PART_M = 0.04


def _cross(t: np.ndarray, y: np.ndarray, i: int, level: float = 0.0) -> float:
    """Time where y crosses `level` between samples i and i + 1, by linear interpolation."""
    y0, y1 = y[i], y[i + 1]
    f = 0.0 if y1 == y0 else float(np.clip((level - y0) / (y1 - y0), 0.0, 1.0))
    return float(t[i] + f * (t[i + 1] - t[i]))


def rises(t: np.ndarray, v: np.ndarray) -> list[tuple[float, float, bool, bool]]:
    """
    Every stretch where v > 0, as (start, end, start_found, end_found). An end is 'found' when the velocity really
    crosses zero there; a stretch cut off by the start or end of the record has its first or last sample instead.
    """
    pos = v > 0
    out: list[tuple[float, float, bool, bool]] = []
    n = len(v)
    i = 0
    while i < n:
        if not pos[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and pos[j + 1]:
            j += 1
        s = _cross(t, v, i - 1) if i > 0 else float(t[0])
        e = _cross(t, v, j) if j < n - 1 else float(t[-1])
        out.append((s, e, i > 0, j < n - 1))
        i = j + 1
    return out


def concentric_phases(
    t: np.ndarray,
    h: np.ndarray,
    v: np.ndarray,
    a: np.ndarray | None = None,
    *,
    min_rom: float = MIN_ROM_M,
    min_rom_share: float = MIN_ROM_SHARE,
    merge_gap: float = MERGE_GAP_S,
    merge_drop_share: float = MERGE_DROP_SHARE,
) -> list[dict]:
    """
    Concentric phases of a densely sampled vertical bar path: t (s), height h (m, up positive), velocity v (m/s)
    and, for MPV, acceleration a (m/s²; taken from v when omitted). Returns one dict per rep with start, end,
    prop_end (s), rom (m), mcv, mpv, pv (m/s) and complete (both ends are real zero crossings).
    """
    t = np.asarray(t, float)
    h = np.asarray(h, float)
    v = np.asarray(v, float)
    a = np.gradient(v, t) if a is None else np.asarray(a, float)
    if len(t) < 3:
        return []
    hat = lambda x: float(np.interp(x, t, h))  # noqa: E731

    runs = [list(r) for r in rises(t, v)]
    # Merge a rise into the next when the bar only sagged in between (a sticking point), so it is measured whole.
    merged: list[list] = []
    for r in runs:
        if merged:
            p = merged[-1]
            p_rise = hat(p[1]) - hat(p[0])
            r_rise = hat(r[1]) - hat(r[0])
            sag = hat(p[1]) - min(hat(p[1]), hat(r[0]))
            if min(p_rise, r_rise) >= MERGE_MIN_PART_M and r[0] - p[1] <= merge_gap and sag < merge_drop_share * p_rise and hat(r[1]) > hat(p[1]):
                p[1], p[3] = r[1], r[3]
                continue
        merged.append(r)

    roms = [hat(e) - hat(s) for s, e, _, _ in merged]
    if not roms:
        return []
    floor = max(min_rom, min_rom_share * max(roms))
    reps = []
    for (s, e, s_ok, e_ok), rom in zip(merged, roms):
        if rom < floor or e <= s:
            continue
        inside = (t >= s) & (t <= e)
        idx = np.flatnonzero(inside)
        if len(idx) == 0:
            continue
        k = idx[np.argmax(v[idx])]
        pv = float(v[k])
        # Propulsive end: the first sample after the peak where a < −g, interpolated.
        prop_end = e
        after = idx[idx >= k]
        below = after[a[after] < -G]
        if len(below):
            j = below[0]
            prop_end = _cross(t, a + G, j - 1) if j > 0 and t[j - 1] >= s else float(t[j])
            prop_end = min(max(prop_end, s), e)
        prop_rise = hat(prop_end) - hat(s)
        mpv = prop_rise / (prop_end - s) if prop_end > s else rom / (e - s)
        reps.append(
            {
                'start': s,
                'end': e,
                'prop_end': prop_end,
                'rom': rom,
                'mcv': rom / (e - s),
                'mpv': mpv,
                'pv': pv,
                'complete': bool(s_ok and e_ok),
            }
        )
    return reps


ZONES = [
    # Mean concentric velocity zones (m/s), as in mobile/src/domain/vbt.ts ZONES.
    ('absolute', '<0.5', 0.0, 0.5),
    ('accel', '0.5-0.75', 0.5, 0.75),
    ('strength-speed', '0.75-1.0', 0.75, 1.0),
    ('speed-strength', '1.0-1.3', 1.0, 1.3),
    ('speed', '>1.3', 1.3, float('inf')),
]


def zone_of(v: float) -> str:
    """Key of the velocity zone `v` (m/s) falls in, as zoneOf in vbt.ts."""
    for key, _, _, hi in ZONES:
        if v < hi:
            return key
    return ZONES[-1][0]
