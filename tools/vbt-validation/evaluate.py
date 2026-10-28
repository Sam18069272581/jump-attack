#!/usr/bin/env python3
"""
The whole synthetic validation in one command: renders (or reuses) a dataset of squat videos with exact ground
truth, runs both trackers and both analysers on every video, and scores all four combinations against the truth.

  app tracker    + app analyser        the app as it ships (barTrackerHtml.ts in Chromium, then barPath.ts)
  OpenCV tracker + app analyser        is a wrong number the tracker's fault or the analyser's?
  app tracker    + reference analyser
  OpenCV tracker + reference analyser  the independent pipeline (reference_tracker.py)

Every tracker gets the same deliberately imperfect starting circle (8–15 % off in radius, a little off-centre),
like a thumb on a phone. Writes results.json (everything, per rep) and report.md (tables per velocity zone and per
condition, failures listed) to the work directory.

Usage:
  python3 evaluate.py --quick                 about 5 minutes: 10 videos
  python3 evaluate.py                         the full dataset (about 50 videos; well under 25 minutes on 4 cores)
  python3 evaluate.py --size 20 --work /tmp/v --pages 4 --jobs 4
  python3 evaluate.py --rescore               score again without tracking (e.g. after changing stats)
Tracking is redone for a video only when its output is missing or the app's tracker/analyser source changed
(--fresh forces it). --app-src points at another copy of mobile/src, e.g. a commit exported with git archive.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

import kinematics
import reference_tracker
import stats
import synth

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../..'))
PIPELINES = [('app', 'app'), ('opencv', 'app'), ('app', 'ref'), ('opencv', 'ref')]
LABEL = {
    ('app', 'app'): 'app tracker + app analyser (as shipped)',
    ('opencv', 'app'): 'OpenCV tracker + app analyser',
    ('app', 'ref'): 'app tracker + reference analyser',
    ('opencv', 'ref'): 'OpenCV tracker + reference analyser',
}
METRICS = ['mcv', 'mpv', 'pv', 'rom']
UNITS = {'mcv': 'm/s', 'mpv': 'm/s', 'pv': 'm/s', 'rom': 'm'}
ZONE_LABEL = {k: label for k, label, _, _ in kinematics.ZONES}
#: The athlete's tested back-squat 1RM, kg, and the app's squat MVT (mobile/src/domain/vbt.ts).
ONE_RM = 165.0
MVT = 0.30


def log(msg: str) -> None:
    print(msg, flush=True)


def pkey(p) -> str:
    return f'{p[0]}+{p[1]}'


# ---------------------------------------------------------------------------------------------------------------
# Running the pipelines
# ---------------------------------------------------------------------------------------------------------------


def app_source_hash(src: str) -> str:
    h = hashlib.sha1()
    for rel in ('media/barTrackerHtml.ts', 'domain/barPath.ts'):
        with open(os.path.join(src, rel), 'rb') as fh:
            h.update(fh.read())
    return h.hexdigest()[:12]


def start_circle(truth: dict) -> list[float]:
    """Where a thumb puts the circle: near the plate, 8–15 % too big or too small."""
    rng = np.random.default_rng(int(hashlib.sha1(truth['name'].encode()).hexdigest()[:8], 16))
    p = truth['plate']
    r = p['vertical_px'] / 2
    k = rng.uniform(1.08, 1.15) if rng.random() < 0.5 else rng.uniform(0.85, 0.92)
    return [p['x0'] + rng.uniform(-0.1, 0.1) * r, p['y0'] + rng.uniform(-0.1, 0.1) * r, r * k]


def node_env() -> dict:
    env = dict(os.environ)
    try:
        root = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True, check=True).stdout.strip()
        env['NODE_PATH'] = root + (os.pathsep + env['NODE_PATH'] if env.get('NODE_PATH') else '')
    except (OSError, subprocess.CalledProcessError):
        pass
    return env


def run_app_tracker(truths: list[dict], data: str, out: str, pages: int, src: str, src_hash: str, fresh: bool) -> None:
    jobs = []
    for g in truths:
        dst = os.path.join(out, g['name'] + '.samples.json')
        if not fresh and os.path.exists(dst):
            with open(dst) as fh:
                old = json.load(fh)
            if old.get('src_hash') == src_hash and not old.get('error'):
                continue
        jobs.append({'video': os.path.join(data, g['video']), 'circle': start_circle(g), 'fps': g['fps_reported'], 'out': dst, 'name': g['name']})
    if not jobs:
        log('  app tracker: all up to date')
        return
    jobs.sort(key=lambda j: -os.path.getsize(j['video']))
    path = os.path.join(out, 'jobs.json')
    with open(path, 'w') as fh:
        json.dump(jobs, fh)
    subprocess.run(['node', os.path.join(HERE, 'run_app.js'), 'track-batch', path, '--pages', str(pages), '--src', src], check=True, env=node_env())
    for j in jobs:
        with open(j['out']) as fh:
            res = json.load(fh)
        res['src_hash'] = src_hash
        with open(j['out'], 'w') as fh:
            json.dump(res, fh)


def _cv_job(args) -> tuple[str, str | None]:
    video, hint, dst = args
    try:
        res = reference_tracker.track(video, tuple(hint), log=log)
    except Exception as e:  # noqa: BLE001 — a crash is a result, reported as such
        res = {'tracker': 'opencv', 'error': f'{type(e).__name__}: {e}'}
    with open(dst, 'w') as fh:
        json.dump(res, fh)
    return os.path.basename(video), res.get('error')


def run_cv_tracker(truths: list[dict], data: str, out: str, jobs: int, fresh: bool) -> None:
    todo = []
    for g in truths:
        dst = os.path.join(out, g['name'] + '.samples.json')
        if fresh or not os.path.exists(dst):
            todo.append((os.path.join(data, g['video']), start_circle(g), dst))
    if not todo:
        log('  opencv tracker: all up to date')
        return
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        for name, err in pool.map(_cv_job, todo):
            if err:
                log(f'  opencv tracker {name}: ERROR {err}')


def run_analysers(truths: list[dict], work: str, src: str, cutoff: float) -> None:
    jobs = []
    for tracker in ('app', 'opencv'):
        for g in truths:
            s = os.path.join(work, tracker, g['name'] + '.samples.json')
            jobs.append({'samples': s, 'timeScale': g['time_scale'], 'out': os.path.join(work, tracker, g['name'] + '.app.json')})
            with open(s) as fh:
                data = json.load(fh)
            try:
                res = reference_tracker.analyse(data, g['time_scale'], cutoff=cutoff)
            except Exception as e:  # noqa: BLE001
                res = {'analyser': 'reference', 'error': f'{type(e).__name__}: {e}', 'reps': []}
            with open(os.path.join(work, tracker, g['name'] + '.ref.json'), 'w') as fh:
                json.dump(res, fh)
    path = os.path.join(work, 'analyse-jobs.json')
    with open(path, 'w') as fh:
        json.dump(jobs, fh)
    subprocess.run(['node', os.path.join(HERE, 'run_app.js'), 'analyse-batch', path, '--src', src], check=True, env=node_env())


# ---------------------------------------------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------------------------------------------


def conditions(g: dict) -> dict:
    s = g['spec']
    yaw = s['yaw']
    return {
        'fps': f"{s['fps']} fps" + (' slo-mo→30' if s['slowmo'] else ''),
        'timing': 'VFR' if s['vfr'] else 'CFR',
        'yaw': '0–8°' if yaw < 8 else '8–16°' if yaw < 16 else '16–25°',
        'pitch': '|pitch| < 3°' if abs(s['pitch']) < 3 else '|pitch| ≥ 3°',
        'occlusion': 'none' if s['occlusion'] == 0 else 'partial' if s['occlusion'] <= 0.3 else 'heavy',
        'resolution': f"{s['width']}×{s['height']}",
        'style': s['style'],
        'image': 'noisy/compressed' if s['noise'] >= 4.5 or s['crf'] >= 27 else 'clean',
    }


def match_reps(gt: list[dict], meas: list[dict]) -> tuple[dict, list[int]]:
    """Pairs each ground-truth rep with the accepted measured rep overlapping it most (IoU ≥ 0.3)."""
    pairs: dict[int, int] = {}
    used: set[int] = set()
    cand = []
    for i, g in enumerate(gt):
        for j, m in enumerate(meas):
            inter = min(g['end'], m['end']) - max(g['start'], m['start'])
            union = max(g['end'], m['end']) - min(g['start'], m['start'])
            if inter > 0 and union > 0 and inter / union >= 0.3:
                cand.append((inter / union, i, j))
    for _, i, j in sorted(cand, reverse=True):
        if i not in pairs and j not in used:
            pairs[i] = j
            used.add(j)
    return pairs, [j for j in range(len(meas)) if j not in used]


def tracking_error(g: dict, samples: dict) -> dict | None:
    """Spatial error of a tracker against the frame it actually saw, and how far its timestamps are from that frame's."""
    if samples.get('error') or not samples.get('samples'):
        return None
    S = np.array(samples['samples'], float)
    pts = np.array(g['frames']['pts'])
    # The frame showing at each stamp, allowing for stamps rounded to the microsecond at a frame's start.
    shown = np.clip(np.searchsorted(pts, S[:, 0] + 5e-4, side='right') - 1, 0, len(pts) - 1)
    ok = S[:, 3] >= 0.5
    gx, gy = np.array(g['frames']['x'])[shown], np.array(g['frames']['y'])[shown]
    err = np.hypot(S[:, 1] - gx, S[:, 2] - gy)[ok]
    ey = (S[:, 2] - gy)[ok]
    mm_per_px = 450 / g['plate']['vertical_px']
    tdiff = (S[:, 0] - pts[shown]) * g['time_scale'] * 1000
    # Frames of the file the tracker never looked at, and frames it looked at twice.
    seen = np.unique(shown)
    return {
        'n': int(len(S)),
        'confident_share': float(ok.mean()),
        'rmse_px': float(np.sqrt(np.mean(err**2))) if len(err) else None,
        'p95_px': float(np.percentile(err, 95)) if len(err) else None,
        'rmse_y_mm': float(np.sqrt(np.mean(ey**2)) * mm_per_px) if len(ey) else None,
        'max_px': float(err.max()) if len(err) else None,
        'scale_err_pct': 100 * (samples['diameter'] / g['plate']['vertical_px'] - 1),
        'stamp_offset_ms_mean': float(np.mean(tdiff)),
        'stamp_offset_ms_sd': float(np.std(tdiff)),
        'stamp_offset_ms_max': float(np.max(np.abs(tdiff))),
        'frames_skipped': int(len(pts) - len(seen)),
        'frames_repeated': int(len(S) - len(seen)),
        'lost': bool(samples.get('lost')),
    }


def score(truths: list[dict], work: str) -> dict:
    reps: list[dict] = []
    videos: dict[str, dict] = {}
    detect: dict[str, dict] = {pkey(p): {'tp': 0, 'fp': 0, 'fn': 0, 'rejected_true': 0, 'rejected_false': 0} for p in PIPELINES}
    failures: list[dict] = []
    for g in truths:
        cond = conditions(g)
        v = {'conditions': cond, 'spec': g['spec'], 'gt_reps': len(g['reps']), 'tracking': {}, 'pipelines': {}}
        for tracker in ('app', 'opencv'):
            with open(os.path.join(work, tracker, g['name'] + '.samples.json')) as fh:
                samples = json.load(fh)
            te = tracking_error(g, samples)
            v['tracking'][tracker] = te or {'error': samples.get('error', 'no samples')}
            if samples.get('error'):
                failures.append({'video': g['name'], 'stage': f'{tracker} tracker', 'what': samples['error']})
            elif samples.get('lost'):
                failures.append({'video': g['name'], 'stage': f'{tracker} tracker', 'what': 'lost the plate'})
        for p in PIPELINES:
            k = pkey(p)
            with open(os.path.join(work, p[0], f"{g['name']}.{p[1]}.json")) as fh:
                res = json.load(fh)
            if res.get('error'):
                failures.append({'video': g['name'], 'stage': k, 'what': res['error']})
            meas = res.get('reps', [])
            accepted = [m for m in meas if m.get('valid', True)]
            pairs, extra = match_reps(g['reps'], accepted)
            d = detect[k]
            d['tp'] += len(pairs)
            d['fp'] += len(extra)
            d['fn'] += len(g['reps']) - len(pairs)
            # Rejected reps: was the rejection right (no true rep there) or did it throw away a good one?
            rejected = [m for m in meas if not m.get('valid', True)]
            rp, rx = match_reps(g['reps'], rejected)
            d['rejected_true'] += len(rp)
            d['rejected_false'] += len(rx)
            for j in extra:
                failures.append({'video': g['name'], 'stage': k, 'what': f"extra rep {accepted[j]['start']:.2f}–{accepted[j]['end']:.2f} s, MCV {accepted[j]['mcv']:.2f}"})
            for i, gr in enumerate(g['reps']):
                if i not in pairs:
                    why = 'rejected (' + str(rejected[rp[i]].get('reason')) + ')' if i in rp else 'not found'
                    failures.append({'video': g['name'], 'stage': k, 'what': f"missed rep {i + 1} (MCV {gr['mcv']:.2f}): {why}"})
                    continue
                m = accepted[pairs[i]]
                rec = {'video': g['name'], 'pipeline': k, 'rep': i + 1, 'zone': gr['zone'], **cond, 'retest_of': g['spec'].get('retest_of')}
                for metric in METRICS:
                    rec['gt_' + metric] = gr[metric]
                    rec[metric] = m.get(metric)
                rec['d_start_ms'] = 1000 * (m['start'] - gr['start'])
                rec['d_end_ms'] = 1000 * (m['end'] - gr['end'])
                reps.append(rec)
            v['pipelines'][k] = {'reps': len(meas), 'accepted': len(accepted), 'matched': len(pairs), 'warnings': res.get('warnings')}
        videos[g['name']] = v
    return {'reps': reps, 'videos': videos, 'detection': detect, 'failures': failures}


def summarise(scored: dict, truths: list[dict]) -> dict:
    reps = scored['reps']
    out: dict = {'overall': {}, 'by_zone': {}, 'by_condition': {}, 'retest': {}, 'detection': {}}
    for p in PIPELINES:
        k = pkey(p)
        rs = [r for r in reps if r['pipeline'] == k]
        d = scored['detection'][k]
        out['detection'][k] = {**stats.detection(d['tp'], d['fp'], d['fn']), 'rejected_true': d['rejected_true'], 'rejected_false': d['rejected_false']}
        out['overall'][k] = {}
        out['by_zone'][k] = {}
        for metric in METRICS:
            pairs = [(r[metric], r['gt_' + metric]) for r in rs if r[metric] is not None]
            if not pairs:
                continue
            m, c = np.array(pairs).T
            out['overall'][k][metric] = stats.agreement(m, c)
            zc = np.array([r['gt_mcv'] for r in rs if r[metric] is not None])
            out['by_zone'][k][metric] = {}
            for key, _, lo, hi in kinematics.ZONES:
                sel = (zc >= lo) & (zc < hi)
                out['by_zone'][k][metric][key] = stats.agreement(m[sel], c[sel])
        out['by_condition'][k] = {}
        for cname in ('fps', 'timing', 'yaw', 'pitch', 'occlusion', 'resolution', 'style', 'image'):
            groups = {}
            for r in rs:
                groups.setdefault(r[cname], []).append(r)
            out['by_condition'][k][cname] = {}
            for level, group in sorted(groups.items()):
                m = np.array([r['mcv'] for r in group])
                c = np.array([r['gt_mcv'] for r in group])
                vids = [g for g in truths if conditions(g)[cname] == level]
                n_gt = sum(len(g['reps']) for g in vids)
                out['by_condition'][k][cname][level] = {**stats.agreement(m, c), 'recall': len(group) / n_gt if n_gt else float('nan'), 'videos': len(vids)}
        # Test–retest: the same rep measured in a video and in its twin.
        by_rep = {(r['video'], r['rep']): r for r in rs}
        pairs = []
        for g in truths:
            orig = g['spec'].get('retest_of')
            if not orig:
                continue
            for i in range(len(g['reps'])):
                a, b = by_rep.get((orig, i + 1)), by_rep.get((g['name'], i + 1))
                if a and b:
                    pairs.append((a['mcv'], b['mcv'], a['gt_mcv']))
        if pairs:
            A, B, C = np.array(pairs).T
            out['retest'][k] = {'overall': stats.sem_mdc(A, B), 'by_zone': {}}
            for key, _, lo, hi in kinematics.ZONES:
                sel = (C >= lo) & (C < hi)
                if sel.sum() >= 2:
                    out['retest'][k]['by_zone'][key] = stats.sem_mdc(A[sel], B[sel])
    return out


def one_rm_propagation(scored: dict, trials: int = 4000, seed: int = 3) -> dict:
    """
    What the measured MCV errors do to a 1RM estimate. A simulated athlete with the real athlete's 1RM (165 kg)
    and a linear load-velocity profile (1.30 m/s at 40 %, MVT 0.30 m/s at 100 %) does single fastest reps at 50,
    60, 70 and 80 % 1RM; each measured velocity gets a relative error drawn from the pipeline's own errors in that
    velocity zone. The app's rule (vbt.ts checkedOneRm) fits the line and reads 1RM at the general MVT. A personal
    MVT taken from a measured 165 kg rep is tried too.
    """
    rng = np.random.default_rng(seed)
    loads = ONE_RM * np.array([0.5, 0.6, 0.7, 0.8])
    true_v = lambda kg: 1.30 - (kg / ONE_RM - 0.4) / 0.6 * (1.30 - MVT)  # noqa: E731
    out = {}
    for p in PIPELINES:
        k = pkey(p)
        rs = [r for r in scored['reps'] if r['pipeline'] == k]
        if len(rs) < 5:
            continue
        rel = {}
        for key, _, lo, hi in kinematics.ZONES:
            e = [r['mcv'] / r['gt_mcv'] - 1 for r in rs if lo <= r['gt_mcv'] < hi]
            rel[key] = np.array(e) if e else np.array([r['mcv'] / r['gt_mcv'] - 1 for r in rs])

        def measured(v):
            return v * (1 + rng.choice(rel[kinematics.zone_of(v)]))

        est, est_personal, passed = [], [], 0
        for _ in range(trials):
            mv = np.array([measured(true_v(kg)) for kg in loads])
            slope, icpt = np.polyfit(loads, mv, 1)
            r2 = np.corrcoef(loads, mv)[0, 1] ** 2
            if slope >= 0:
                continue
            if r2 >= 0.9 and mv.min() <= 0.75:
                passed += 1
            est.append((MVT - icpt) / slope)
            est_personal.append((measured(MVT) - icpt) / slope)
        est, est_personal = np.array(est), np.array(est_personal)
        out[k] = {
            'general_mvt': {'median_err_kg': float(np.median(est) - ONE_RM), 'p5_kg': float(np.percentile(est, 5) - ONE_RM), 'p95_kg': float(np.percentile(est, 95) - ONE_RM), 'within_5kg': float(np.mean(np.abs(est - ONE_RM) <= 5))},
            'personal_mvt': {'median_err_kg': float(np.median(est_personal) - ONE_RM), 'p5_kg': float(np.percentile(est_personal, 5) - ONE_RM), 'p95_kg': float(np.percentile(est_personal, 95) - ONE_RM), 'within_5kg': float(np.mean(np.abs(est_personal - ONE_RM) <= 5))},
            'passes_app_checks': passed / trials,
        }
    return out


# ---------------------------------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------------------------------


def f(x, nd=3, pct=False) -> str:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return '–'
    return f'{x:+.{nd}f}' if pct else f'{x:.{nd}f}'


def agreement_row(a: dict, unit_nd: int = 3) -> list[str]:
    if not a or a.get('n', 0) == 0:
        return ['0'] + ['–'] * 8
    loa = f"{f(a.get('loa_low'), unit_nd)} … {f(a.get('loa_high'), unit_nd)}" if 'loa_low' in a else '–'
    loa_pct = f"{f(a.get('loa_pct_low'), 1)} … {f(a.get('loa_pct_high'), 1)}" if 'loa_pct_low' in a else '–'
    icc = f"{f(a.get('icc2_1'), 3)} ({f(a.get('icc2_1_low'), 2)}–{f(a.get('icc2_1_high'), 2)})" if 'icc2_1' in a else '–'
    return [
        str(a['n']),
        f(a.get('bias'), unit_nd, True) if 'bias' in a else '–',
        loa,
        f(a.get('bias_pct'), 1, True) if 'bias_pct' in a else '–',
        loa_pct,
        icc,
        f(a.get('cv_pct'), 1),
        f(a.get('see'), unit_nd),
        f(a.get('mae'), unit_nd),
    ]


AGREE_HEAD = ['n', 'bias', '95 % LoA', 'bias %', '95 % LoA %', 'ICC(2,1) (95 % CI)', 'CV %', 'SEE', 'MAE']


def table(head: list[str], rows: list[list[str]]) -> str:
    out = ['| ' + ' | '.join(head) + ' |', '|' + '|'.join('---' for _ in head) + '|']
    out += ['| ' + ' | '.join(r) + ' |' for r in rows]
    return '\n'.join(out)


def report(results: dict) -> str:
    s = results['summary']
    lines = [
        '# VBT validation report (synthetic)',
        '',
        f"Generated {results['generated']} · app source `{results['app_source']}` (hash {results['app_hash']}) · "
        f"{results['videos']} videos, {results['gt_reps']} true reps · dataset `{results['size']}` · {results['minutes']:.1f} min",
        '',
        'Differences are measured − truth. Truth is computed from the exact trajectory with the phase definitions in '
        '`kinematics.py`. LoA: Bland–Altman 95 % limits of agreement. ICC(2,1): absolute agreement. CV: typical error '
        '(SD of differences / √2) as % of the mean. SEE: residual SD of truth predicted from the measurement. Zones are '
        'zones of the true MCV (vbt.ts ZONES), also for MPV, PV and ROM. Only reps the pipeline accepted and that match a '
        'true rep are in the agreement statistics; missed, extra and rejected reps are in the detection table and the '
        'failure list.',
        '',
        '## Summary: MCV',
        '',
        table(['pipeline', *AGREE_HEAD, 'proportional bias (slope, p)'], [
            [LABEL[p], *agreement_row(s['overall'][pkey(p)].get('mcv', {})), prop(s['overall'][pkey(p)].get('mcv', {}))] for p in PIPELINES
        ]),
        '',
        '## Rep detection',
        '',
        table(['pipeline', 'precision', 'recall', 'F1', 'TP', 'extra (FP)', 'missed (FN)', 'rejected, was a true rep', 'rejected, no true rep'], [
            [LABEL[p], f(d['precision']), f(d['recall']), f(d['f1']), str(d['tp']), str(d['fp']), str(d['fn']), str(d['rejected_true']), str(d['rejected_false'])]
            for p in PIPELINES
            for d in [s['detection'][pkey(p)]]
        ]),
        '',
    ]
    for metric, title in [('mcv', 'MCV (m/s)'), ('mpv', 'MPV (m/s)'), ('pv', 'Peak velocity (m/s)'), ('rom', 'ROM (m)')]:
        lines += [f'## {title} by velocity zone', '']
        for p in PIPELINES:
            z = s['by_zone'][pkey(p)].get(metric)
            if not z:
                lines += [f'**{LABEL[p]}**: not reported by this pipeline.', '']
                continue
            rows = [[ZONE_LABEL[k], *agreement_row(z[k])] for k, *_ in kinematics.ZONES]
            rows.append(['all', *agreement_row(s['overall'][pkey(p)][metric])])
            lines += [f'**{LABEL[p]}**', '', table(['zone', *AGREE_HEAD], rows), '']
    lines += ['## MCV by condition', '', 'Bias % and its 95 % LoA %, MAE (m/s), and recall (share of true reps found and accepted).', '']
    for cname in ('fps', 'timing', 'yaw', 'pitch', 'occlusion', 'resolution', 'style', 'image'):
        levels = sorted({lv for p in PIPELINES for lv in s['by_condition'][pkey(p)].get(cname, {})})
        rows = []
        for lv in levels:
            row = [lv]
            for p in PIPELINES:
                a = s['by_condition'][pkey(p)][cname].get(lv)
                if not a:
                    row.append('–')
                    continue
                loa = f"{f(a.get('loa_pct_low'), 1)}…{f(a.get('loa_pct_high'), 1)}" if 'loa_pct_low' in a else ''
                row.append(f"{f(a.get('bias_pct'), 1, True) if 'bias_pct' in a else '–'} [{loa}] MAE {f(a.get('mae'))} · n {a['n']} · recall {f(a.get('recall'), 2)}")
            rows.append(row)
        lines += [f'**{cname}**', '', table([cname, *[LABEL[p] for p in PIPELINES]], rows), '']
    lines += ['## Test–retest (the same reps filmed twice)', '', 'SEM and MDC95 of MCV between a video and its twin: same motion, camera moved slightly, new noise, shake, light and starting circle. This is measurement error only; a real retest adds the athlete\'s own variation.', '']
    rows = []
    for p in PIPELINES:
        rt = s['retest'].get(pkey(p))
        if not rt:
            continue
        for k in ['overall', *[z for z, *_ in kinematics.ZONES]]:
            a = rt['overall'] if k == 'overall' else rt['by_zone'].get(k)
            if a:
                rows.append([LABEL[p], 'all' if k == 'overall' else ZONE_LABEL[k], str(a['n']), f(a['sem']), f(a['sem_pct'], 1), f(a['mdc95']), f(a['mdc95_pct'], 1), f(a.get('icc2_1'))])
    lines += [table(['pipeline', 'zone', 'pairs', 'SEM (m/s)', 'SEM %', 'MDC95 (m/s)', 'MDC95 %', 'ICC(2,1)'], rows) if rows else 'No retest pairs matched.', '']
    lines += ['## Tracking', '', 'Position error against the frame the tracker actually decoded (so timing errors are not counted here); timestamp offset is the tracker\'s time minus that frame\'s real time.', '']
    rows = []
    for tracker in ('app', 'opencv'):
        for name, v in results['videos_detail'].items():
            t = v['tracking'][tracker]
            if 'error' in t:
                rows.append([tracker, name, 'ERROR: ' + str(t['error'])] + [''] * 7)
                continue
            rows.append([tracker, name, f(t['rmse_px'], 2), f(t['p95_px'], 2), f(t['rmse_y_mm'], 2), f(t['scale_err_pct'], 2, True), f"{f(t['stamp_offset_ms_mean'], 1, True)} ± {f(t['stamp_offset_ms_sd'], 1)}", str(t['frames_skipped']), str(t['frames_repeated']), f(t['confident_share'], 3) + (' LOST' if t['lost'] else '')])
    lines += [table(['tracker', 'video', 'RMSE px', 'P95 px', 'RMSE y mm', 'scale err %', 'stamp offset ms', 'frames skipped', 'frames repeated', 'confident share'], rows), '']
    lines += ['## What the MCV errors do to a 1RM estimate', '', one_rm_text(results['one_rm']), '']
    lines += ['## Failures', '']
    if results['failures']:
        lines += [table(['video', 'stage', 'what'], [[x['video'], x['stage'], x['what']] for x in results['failures']]), '']
    else:
        lines += ['None.', '']
    lines += ['## Worst MCV errors', '']
    worst = sorted(results['reps'], key=lambda r: -abs(r['mcv'] / r['gt_mcv'] - 1))[:15]
    lines += [table(['pipeline', 'video', 'rep', 'true MCV', 'measured', 'error %', 'start Δ ms', 'end Δ ms', 'conditions'], [
        [r['pipeline'], r['video'], str(r['rep']), f(r['gt_mcv']), f(r['mcv']), f(100 * (r['mcv'] / r['gt_mcv'] - 1), 1, True), f(r['d_start_ms'], 0, True), f(r['d_end_ms'], 0, True), f"{r['fps']}, {r['timing']}, yaw {r['yaw']}, occl {r['occlusion']}, {r['style']}"]
        for r in worst
    ]), '']
    lines += ['## Videos', '', table(['video', 'style', 'true MCVs', 'fps', 'timing', 'yaw', 'pitch', 'occl', 'res', 'noise/crf'], [
        [n, v['spec']['style'], ' '.join(f'{x:.2f}' for x in v['spec']['mcv']), str(v['spec']['fps']) + (' slo-mo' if v['spec']['slowmo'] else ''), v['conditions']['timing'], f"{v['spec']['yaw']:.0f}°", f"{v['spec']['pitch']:+.0f}°", f"{v['spec']['occlusion']:.2f}", f"{v['spec']['width']}×{v['spec']['height']}", f"{v['spec']['noise']:.1f}/{v['spec']['crf']}"]
        for n, v in results['videos_detail'].items()
    ]), '']
    return '\n'.join(lines)


def prop(a: dict) -> str:
    if 'prop_slope' not in a:
        return '–'
    return f"{a['prop_slope']:+.3f} (p {a['prop_p']:.2g})"


def one_rm_text(o: dict) -> str:
    rows = []
    for p in PIPELINES:
        x = o.get(pkey(p))
        if not x:
            continue
        g, q = x['general_mvt'], x['personal_mvt']
        rows.append([LABEL[p], f"{g['median_err_kg']:+.1f} ({g['p5_kg']:+.1f} … {g['p95_kg']:+.1f})", f"{100 * g['within_5kg']:.0f} %", f"{q['median_err_kg']:+.1f} ({q['p5_kg']:+.1f} … {q['p95_kg']:+.1f})", f"{100 * q['within_5kg']:.0f} %", f"{100 * x['passes_app_checks']:.0f} %"])
    intro = (
        f'Simulated athlete with a {ONE_RM:.0f} kg back-squat 1RM, single fastest reps at 50/60/70/80 % measured with each '
        f"pipeline's own relative MCV errors (resampled per zone). 1RM error in kg: median (5th … 95th percentile).\n\n"
    )
    return intro + table(['pipeline', f'1RM at MVT {MVT} m/s', 'within ±5 kg', 'with personal MVT (measured 165 kg rep)', 'within ±5 kg', 'passes app checks'], rows)


# ---------------------------------------------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--quick', action='store_true', help='the quick dataset (same as --size quick)')
    ap.add_argument('--size', default='full', help='quick, full or a number of sets')
    ap.add_argument('--work', default=os.path.join(HERE, 'work'))
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 2, help='processes for rendering and OpenCV tracking')
    ap.add_argument('--pages', type=int, default=max(1, (os.cpu_count() or 2) - 1), help='Chromium pages tracking at once')
    ap.add_argument('--app-src', default=os.path.join(REPO, 'mobile/src'))
    ap.add_argument('--cutoff', type=float, default=6.0, help='reference analyser low-pass cutoff, Hz')
    ap.add_argument('--fresh', action='store_true', help='track every video again')
    ap.add_argument('--rescore', action='store_true', help='only analyse and score what is already tracked')
    a = ap.parse_args()
    size = 'quick' if a.quick else a.size
    began = time.time()
    work = os.path.abspath(a.work)
    data = os.path.join(work, 'data')
    for d in (data, os.path.join(work, 'app'), os.path.join(work, 'opencv')):
        os.makedirs(d, exist_ok=True)
    src = os.path.abspath(a.app_src)
    src_hash = app_source_hash(src)
    specs = synth.dataset(size)
    timings = {}

    log(f'dataset {size}: {len(specs)} videos → {data}')
    t0 = time.time()
    failed = synth.render_dataset(specs, data, a.jobs, log=log)
    timings['render_s'] = time.time() - t0
    truths = []
    for s in specs:
        if s.name in failed:
            continue
        with open(os.path.join(data, s.name + '.json')) as fh:
            truths.append(json.load(fh))
    if not a.rescore:
        log(f'app tracker ({src}, {a.pages} pages)')
        t0 = time.time()
        run_app_tracker(truths, data, os.path.join(work, 'app'), a.pages, src, src_hash, a.fresh)
        timings['app_tracker_s'] = time.time() - t0
        log('OpenCV tracker')
        t0 = time.time()
        run_cv_tracker(truths, data, os.path.join(work, 'opencv'), a.jobs, a.fresh)
        timings['opencv_tracker_s'] = time.time() - t0
    log('analysers')
    t0 = time.time()
    run_analysers(truths, work, src, a.cutoff)
    timings['analysers_s'] = time.time() - t0
    log('scoring')
    scored = score(truths, work)
    summary = summarise(scored, truths)
    failures = [{'video': n, 'stage': 'render', 'what': 'failed to render'} for n in failed] + scored['failures']
    try:
        rev = subprocess.run(['git', '-C', REPO, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', REPO, 'status', '--porcelain', '--', 'mobile/src'], capture_output=True, text=True).stdout.strip()
    except OSError:
        rev, dirty = '?', ''
    app_source = src if src != os.path.join(REPO, 'mobile/src') else f"working tree at {rev}{' + uncommitted changes' if dirty else ''}"
    results = {
        'generated': dt.datetime.now().isoformat(timespec='seconds'),
        'size': size,
        'app_source': app_source,
        'app_hash': src_hash,
        'videos': len(truths),
        'gt_reps': sum(len(g['reps']) for g in truths),
        'settings': {'cutoff_hz': a.cutoff, 'pages': a.pages, 'jobs': a.jobs},
        'timings_s': timings,
        'summary': summary,
        'one_rm': one_rm_propagation(scored),
        'failures': failures,
        'videos_detail': scored['videos'],
        'reps': scored['reps'],
    }
    results['minutes'] = (time.time() - began) / 60
    with open(os.path.join(work, 'results.json'), 'w') as fh:
        json.dump(results, fh, indent=1, default=float)
    rep = report(results)
    with open(os.path.join(work, 'report.md'), 'w') as fh:
        fh.write(rep)
    log(f"done in {results['minutes']:.1f} min → {os.path.join(work, 'report.md')}")
    for p in PIPELINES:
        a_ = summary['overall'][pkey(p)].get('mcv', {})
        d = summary['detection'][pkey(p)]
        if a_:
            log(f"  {LABEL[p]:42s} MCV bias {a_.get('bias_pct', float('nan')):+.1f} % (LoA {a_.get('loa_pct_low', float('nan')):+.1f} … {a_.get('loa_pct_high', float('nan')):+.1f} %), MAE {a_['mae']:.3f} m/s, n {a_['n']}, recall {d['recall']:.2f}, precision {d['precision']:.2f}")


if __name__ == '__main__':
    main()
