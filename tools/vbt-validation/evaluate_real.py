#!/usr/bin/env python3
"""
The athlete's own videos against a reference device, and the 1RM check against a lifted 1RM.

Runs the app's tracker and analyser (run_app.js, as in evaluate.py) and the independent OpenCV pipeline on every
video listed in sets.csv, pairs each rep with the reference (a linear position transducer such as GymAware or
Vitruve, VBTgo, or a manual Kinovea track) and reports, per velocity zone of the reference MCV: Bland–Altman bias
and limits of agreement, ICC, CV, SEE and MAE. Sets filmed on a second day give SEM and MDC95 between days. The
fastest rep per load gives the athlete's load–velocity profile, its 1RM at the app's MVT (0.30 m/s) against the
lifted 1RM, and the personal MVT: the velocity measured on the lifted 1RM rep itself, when it was filmed.

Inputs, in one folder:

  sets.csv        video,day,load_kg[,slowmo_fps,circle_x,circle_y,circle_r]
                  One row per video (one set per video). day: 1 or 2 for a retest on another day. slowmo_fps: the
                  capture rate of a slow-motion clip saved at 30 fps (else empty). circle_*: the plate in the first
                  frame in video pixels, if the automatic search finds the wrong thing; else empty.
  reference.csv   video,rep,mcv[,mpv,pv]
                  One row per rep from the reference device, reps numbered from 1 in order. mpv and pv optional.
  the videos      as named in sets.csv (iPhone .MOV is fine: it is converted to H.264 for the headless browser,
                  keeping every frame's timestamp).

Usage:
  python3 evaluate_real.py DIR [--one-rm 165] [--work DIR/work] [--pages 3] [--jobs 4]
Writes DIR/work/report_real.md and results_real.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess

import numpy as np

import evaluate
import reference_tracker
import stats

HERE = os.path.dirname(os.path.abspath(__file__))
MVT = evaluate.MVT
ZONE_LABEL = evaluate.ZONE_LABEL


def read_csv(path: str) -> list[dict]:
    with open(path, newline='', encoding='utf-8-sig') as fh:
        return [{k.strip(): (v or '').strip() for k, v in row.items()} for row in csv.DictReader(fh)]


def num(x: str) -> float | None:
    return float(x) if x not in ('', None) else None


def to_h264(src: str, dst: str) -> None:
    """A copy Chromium can decode, with every frame kept at its own timestamp (no frame rate conversion)."""
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-an', dst],
        check=True,
    )


def frame_rate(video: str) -> float:
    """Median frame rate from the frame timestamps, as the app's player reports it."""
    pts = reference_tracker.frame_pts(video)
    return float(1 / np.median(np.diff(pts))) if len(pts) > 1 else 0.0


def track_all(sets: list[dict], folder: str, work: str, pages: int, jobs: int) -> None:
    os.makedirs(os.path.join(work, 'video'), exist_ok=True)
    for tracker in ('app', 'opencv'):
        os.makedirs(os.path.join(work, tracker), exist_ok=True)
    app_jobs = []
    for s in sets:
        src = os.path.join(folder, s['video'])
        mp4 = os.path.join(work, 'video', os.path.splitext(s['video'])[0] + '.mp4')
        to_h264(src, mp4)
        s['mp4'] = mp4
        s['fps'] = frame_rate(mp4)
        slowmo = num(s.get('slowmo_fps', ''))
        s['time_scale'] = s['fps'] / slowmo if slowmo and s['fps'] <= 30 and slowmo > s['fps'] else 1.0
        hint = (num(s.get('circle_x', '')), num(s.get('circle_y', '')), num(s.get('circle_r', '')))
        cv_out = os.path.join(work, 'opencv', s['name'] + '.samples.json')
        if not os.path.exists(cv_out):
            res = reference_tracker.track(mp4, hint if None not in hint else None, log=evaluate.log)
            with open(cv_out, 'w') as fh:
                json.dump(res, fh)
        with open(cv_out) as fh:
            cv = json.load(fh)
        # The app's starting circle: the athlete's, else where the OpenCV search found the plate (the app snaps it).
        if None not in hint:
            circle = list(hint)
        elif cv.get('samples'):
            circle = [cv['samples'][0][1], cv['samples'][0][2], cv['diameter'] / 2]
        else:
            evaluate.log(f"  {s['video']}: no plate found; give circle_x, circle_y, circle_r in sets.csv")
            continue
        out = os.path.join(work, 'app', s['name'] + '.samples.json')
        if not os.path.exists(out):
            app_jobs.append({'video': mp4, 'circle': circle, 'fps': round(s['fps']), 'out': out, 'name': s['name']})
    if app_jobs:
        path = os.path.join(work, 'jobs.json')
        with open(path, 'w') as fh:
            json.dump(app_jobs, fh)
        subprocess.run(['node', os.path.join(HERE, 'run_app.js'), 'track-batch', path, '--pages', str(pages)], check=True, env=evaluate.node_env())

    analyse_jobs = []
    for s in sets:
        for tracker in ('app', 'opencv'):
            samples = os.path.join(work, tracker, s['name'] + '.samples.json')
            if not os.path.exists(samples):
                continue
            analyse_jobs.append({'samples': samples, 'timeScale': s['time_scale'], 'out': os.path.join(work, tracker, s['name'] + '.app.json')})
            with open(samples) as fh:
                data = json.load(fh)
            try:
                res = reference_tracker.analyse(data, s['time_scale'])
            except Exception as e:  # noqa: BLE001 — a crash is a result, reported as such
                res = {'error': f'{type(e).__name__}: {e}', 'reps': []}
            with open(os.path.join(work, tracker, s['name'] + '.ref.json'), 'w') as fh:
                json.dump(res, fh)
    path = os.path.join(work, 'analyse-jobs.json')
    with open(path, 'w') as fh:
        json.dump(analyse_jobs, fh)
    subprocess.run(['node', os.path.join(HERE, 'run_app.js'), 'analyse-batch', path], check=True, env=evaluate.node_env())


def reps_of(work: str, tracker: str, analyser: str, name: str) -> list[dict] | None:
    path = os.path.join(work, tracker, f'{name}.{analyser}.json')
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        res = json.load(fh)
    return None if res.get('error') else res['reps']


def pair(sets: list[dict], refs: list[dict], work: str) -> list[dict]:
    """Every reference rep with what each pipeline measured for it, matched by order among accepted reps."""
    rows = []
    for s in sets:
        ref = sorted((r for r in refs if r['video'] == s['video']), key=lambda r: int(r['rep']))
        for p in evaluate.PIPELINES:
            reps = reps_of(work, p[0], p[1], s['name'])
            accepted = [r for r in (reps or []) if r.get('valid', True)]
            for i, r in enumerate(ref):
                m = accepted[i] if len(accepted) == len(ref) else None
                rows.append({
                    'video': s['video'], 'day': s['day'], 'load': float(s['load_kg']), 'rep': int(r['rep']), 'pipeline': evaluate.pkey(p),
                    'ref_mcv': float(r['mcv']), 'ref_mpv': num(r.get('mpv', '')), 'ref_pv': num(r.get('pv', '')),
                    'mcv': m['mcv'] if m else None, 'mpv': m.get('mpv') if m else None, 'pv': m['pv'] if m else None,
                    # Reps counted differently from the reference can't be paired by order: say so instead.
                    'found': len(accepted), 'expected': len(ref), 'rejected': len(reps or []) - len(accepted),
                })
    return rows


def profile(points: list[tuple[float, float]]) -> dict | None:
    """Least-squares load–velocity line from (load, fastest MCV) pairs, as domain/vbt.ts lvProfile."""
    if len({p[0] for p in points}) < 2:
        return None
    x, y = np.array([p[0] for p in points]), np.array([p[1] for p in points])
    slope, intercept = np.polyfit(x, y, 1)
    r2 = 1 - np.sum((y - (intercept + slope * x)) ** 2) / np.sum((y - y.mean()) ** 2)
    return {'intercept': float(intercept), 'slope': float(slope), 'r2': float(r2), 'n': len(points)}


def one_rm_check(rows: list[dict], one_rm: float) -> dict:
    """Per pipeline and day: the profile from the fastest rep per load below the lifted 1RM, and what it says."""
    out = {}
    for pipeline in sorted({r['pipeline'] for r in rows} | {'reference'}):
        for day in sorted({r['day'] for r in rows}):
            key = 'ref_mcv' if pipeline == 'reference' else 'mcv'
            sel = [r for r in rows if r['day'] == day and (pipeline == 'reference' or r['pipeline'] == pipeline) and r[key] is not None]
            if pipeline == 'reference':
                sel = [r for r in sel if r['pipeline'] == evaluate.pkey(evaluate.PIPELINES[0])]
            fastest: dict[float, float] = {}
            for r in sel:
                fastest[r['load']] = max(fastest.get(r['load'], 0), r[key])
            below = [(kg, v) for kg, v in fastest.items() if kg < one_rm * 0.97]
            at_max = [v for kg, v in fastest.items() if kg >= one_rm * 0.97]
            prof = profile(below)
            res: dict = {'loads': sorted(fastest.items()), 'profile': prof}
            if prof and prof['slope'] < 0:
                res['one_rm_at_mvt'] = (MVT - prof['intercept']) / prof['slope']
                res['v_at_one_rm'] = prof['intercept'] + prof['slope'] * one_rm
                res['heaviest_v'] = min(v for _, v in below)
            if at_max:
                # The velocity of the lifted 1RM itself: the athlete's own minimum velocity threshold.
                res['personal_mvt'] = max(at_max)
                if prof and prof['slope'] < 0:
                    res['one_rm_at_personal_mvt'] = (res['personal_mvt'] - prof['intercept']) / prof['slope']
            out[f'{pipeline} · day {day}'] = res
    return out


def report(rows: list[dict], one: dict, sets: list[dict], one_rm: float) -> str:
    f, table = evaluate.f, evaluate.table
    L = ['# VBT validation on real video', '',
         f'{len(sets)} videos, {len({(r["video"], r["rep"]) for r in rows})} reference reps. Differences are app − reference. Zones are zones of the reference MCV.', '']
    L += ['## MCV agreement with the reference', '']
    for p in evaluate.PIPELINES:
        k = evaluate.pkey(p)
        sel = [r for r in rows if r['pipeline'] == k and r['mcv'] is not None]
        lines = []
        for zone, (c, d) in stats.by_zone([r['ref_mcv'] for r in sel], [r['mcv'] for r in sel]).items():
            if len(c):
                lines.append([ZONE_LABEL[zone]] + evaluate.agreement_row(stats.agreement(d, c)))
        lines.append(['all'] + evaluate.agreement_row(stats.agreement([r['mcv'] for r in sel], [r['ref_mcv'] for r in sel])))
        L += [f'**{evaluate.LABEL[p]}**', '', table(['zone'] + evaluate.AGREE_HEAD, lines), '']
    for metric in ('mpv', 'pv'):
        sel = [r for r in rows if r['pipeline'] == 'app+app' and r[metric] is not None and r[f'ref_{metric}'] is not None]
        if sel:
            a = stats.agreement([r[metric] for r in sel], [r[f'ref_{metric}'] for r in sel])
            L += [f'**{metric.upper()}, app as shipped**', '', table(['zone'] + evaluate.AGREE_HEAD, [['all'] + evaluate.agreement_row(a)]), '']

    miscounted = sorted({(r['video'], r['found'], r['expected'], r['rejected']) for r in rows if r['pipeline'] == 'app+app' and r['found'] != r['expected']})
    if miscounted:
        L += ['## Sets the app counted differently from the reference', '', table(['video', 'accepted by the app', 'reference reps', 'flagged and left out'], [[v, str(a), str(b), str(c)] for v, a, b, c in miscounted]), '']

    days = sorted({r['day'] for r in rows})
    if len(days) > 1:
        L += ['## Day-to-day reliability (fastest rep per load, day 1 vs day 2)', '']
        lines = []
        for k in ['reference'] + [evaluate.pkey(p) for p in evaluate.PIPELINES]:
            d1 = one.get(f'{k} · day {days[0]}', {}).get('loads', [])
            d2 = dict(one.get(f'{k} · day {days[1]}', {}).get('loads', []))
            pairs = [(v, d2[kg]) for kg, v in d1 if kg in d2]
            if len(pairs) >= 2:
                s = stats.sem_mdc([a for a, _ in pairs], [b for _, b in pairs])
                lines.append([k, str(s['n']), f(s['sem'], 3), f(s['sem_pct'], 1), f(s['mdc95'], 3), f(s['mdc95_pct'], 1), f(s.get('icc2_1'), 3)])
        L += [table(['pipeline', 'loads', 'SEM (m/s)', 'SEM %', 'MDC95 (m/s)', 'MDC95 %', 'ICC(2,1)'], lines), '']

    L += [f'## Load–velocity profile and 1RM against the lifted {one_rm:g} kg', '']
    lines = []
    for k, res in one.items():
        prof = res.get('profile')
        lines.append([
            k,
            ' '.join(f'{kg:g}:{v:.2f}' for kg, v in res['loads']),
            f'{prof["intercept"]:.3f} {prof["slope"]:+.4f}·kg, r² {prof["r2"]:.3f}' if prof else '–',
            f(res.get('one_rm_at_mvt'), 1),
            f(res.get('one_rm_at_mvt', math.nan) - one_rm, 1, True) if 'one_rm_at_mvt' in res else '–',
            f(res.get('v_at_one_rm'), 3),
            f(res.get('personal_mvt'), 3),
            f(res.get('one_rm_at_personal_mvt'), 1),
        ])
    L += [table(['pipeline · day', 'fastest MCV per load (kg:m/s)', 'profile', f'1RM at MVT {MVT}', 'error kg', 'profile velocity at the lifted 1RM', 'personal MVT (filmed 1RM rep)', '1RM at personal MVT'], lines), '']
    L += ['How to read it: if the profile velocity at the lifted 1RM is clearly above or below 0.30 m/s, the generic MVT does not fit this athlete, and the personal MVT (or that velocity) is the one to use. A 1RM error is only meaningful next to the MCV error above: 3 % in MCV near 0.3 m/s moves the estimate by several kg.', '']
    return '\n'.join(L)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('--one-rm', type=float, default=evaluate.ONE_RM)
    ap.add_argument('--work')
    ap.add_argument('--pages', type=int, default=3)
    ap.add_argument('--jobs', type=int, default=4)
    a = ap.parse_args()
    work = a.work or os.path.join(a.folder, 'work')
    os.makedirs(work, exist_ok=True)
    sets = read_csv(os.path.join(a.folder, 'sets.csv'))
    for s in sets:
        s['name'] = os.path.splitext(s['video'])[0]
        s['day'] = s.get('day') or '1'
    refs = read_csv(os.path.join(a.folder, 'reference.csv'))
    track_all(sets, a.folder, work, a.pages, a.jobs)
    rows = pair(sets, refs, work)
    one = one_rm_check(rows, a.one_rm)
    with open(os.path.join(work, 'results_real.json'), 'w') as fh:
        json.dump({'rows': rows, 'one_rm': one, 'sets': [{k: v for k, v in s.items()} for s in sets]}, fh, indent=1)
    text = report(rows, one, sets, a.one_rm)
    with open(os.path.join(work, 'report_real.md'), 'w') as fh:
        fh.write(text)
    print(text)


if __name__ == '__main__':
    main()
