#!/usr/bin/env python3
"""
An independent bar tracker and analyser built from standard OpenCV and SciPy pieces, to check the app's pipeline
against something that shares none of its code or shortcuts.

Tracking (`track`)
- Timestamps: every frame's presentation time as the container stores it (ffprobe pts), cross-checked against
  cv2.CAP_PROP_POS_MSEC; never frame index ÷ nominal fps, so variable-frame-rate files are timed correctly.
- The plate is an ellipse, not a circle: a camera yawed off the bar axis sees it foreshortened sideways. Rays are
  cast from the centre; on each the outermost strong radial step in brightness is a rim candidate; RANSAC finds
  the ellipse most rays agree on and cv2.fitEllipseDirect fits it to them. On the first frame this starts from a
  rough hint (where a user would tap) or from Hough circles; after that from the prediction, in a narrow band.
- Frame to frame: Lucas–Kanade optical flow of corners on the plate face (forward–backward checked) gives a
  similarity transform by RANSAC, so the plate turning on the sleeve doesn't matter; that predicts the centre, and
  the rim ellipse re-fitted around it is the measurement (absolute, so it can't drift). When the rim can't be fitted
  (occlusion, blur) the flow estimate stands in with lower confidence, then masked template matching.
- Scale: the plate's vertical chord through its centre in each frame (`d`), which a vertical bar movement is
  foreshortened with, unlike the major axis or a fitted circle.

Analysis (`analyse`, also on the app tracker's samples)
- Heights from the vertical chord (perspective-corrected: chord modelled as a straight line in image y, so a
  pitched camera's changing scale along the path is integrated rather than taken from the first frame).
- Resampled to an even grid, low-passed by a zero-lag Butterworth filter (`order` 2 run forwards and backwards is
  the 4th-order zero-lag filter of biomechanics, cutoff corrected for the double pass), differentiated.
- Concentric phases, MCV, MPV, PV and ROM by the definitions in kinematics.py. The filter rounds off the instants
  the bar starts and stops, which matters for mean velocity, so those two are refined: a line through a lighter-
  filtered velocity (`edge_cutoff`) as it ramps up off the bottom and down into the top, extended to zero.
- Reps that can't be trusted are kept but flagged: truncated, gap, unsure, partial, drift, implausible.

Usage:
  python3 reference_tracker.py track VIDEO [--hint x,y,r] [--out samples.json]
  python3 reference_tracker.py analyse SAMPLES.json [--time-scale s] [--cutoff 6] [--out reps.json]
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time

import cv2
import numpy as np
from scipy import interpolate, signal, stats

import kinematics

PLATE_D = 0.45
#: Minor ÷ major axis of the plate's outline: a camera up to ~35° off the bar axis. Rounder than this is not the plate.
MIN_AXIS_RATIO = 0.8

# ---------------------------------------------------------------------------------------------------------------
# Timestamps
# ---------------------------------------------------------------------------------------------------------------


def frame_pts(video: str) -> np.ndarray:
    """Presentation time (s) of every frame in decode-output order, from the container."""
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'json', video],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    frames = json.loads(out)['frames']
    return np.array([float(f.get('pts_time') or f.get('best_effort_timestamp_time')) for f in frames])


# ---------------------------------------------------------------------------------------------------------------
# Rim ellipse
# ---------------------------------------------------------------------------------------------------------------


class Ellipse:
    """Centre, semi-axes a (along `angle`) and b, angle in degrees, as cv2.fitEllipse reports (halved)."""

    def __init__(self, cx: float, cy: float, a: float, b: float, angle: float):
        self.cx, self.cy, self.a, self.b, self.angle = cx, cy, a, b, angle

    @classmethod
    def from_cv(cls, e) -> 'Ellipse':
        (cx, cy), (w, h), ang = e
        return cls(cx, cy, w / 2, h / 2, ang)

    def radius_towards(self, theta: np.ndarray) -> np.ndarray:
        """Distance from the centre to the outline in image direction theta (rad)."""
        phi = math.radians(self.angle)
        u, v = np.cos(theta - phi), np.sin(theta - phi)
        return 1 / np.sqrt((u / self.a) ** 2 + (v / self.b) ** 2)

    def distance(self, pts: np.ndarray) -> np.ndarray:
        """Approximate distance (px) of points from the outline, along the ray from the centre."""
        phi = math.radians(self.angle)
        dx, dy = pts[:, 0] - self.cx, pts[:, 1] - self.cy
        u = dx * math.cos(phi) + dy * math.sin(phi)
        v = -dx * math.sin(phi) + dy * math.cos(phi)
        rho = np.sqrt((u / self.a) ** 2 + (v / self.b) ** 2)
        r = np.hypot(dx, dy)
        return np.abs(r - r / np.maximum(rho, 1e-9))

    @property
    def vertical(self) -> float:
        """Length of the chord through the centre along image y: what a vertical bar movement is scaled by."""
        return 2 * float(self.radius_towards(np.array(math.pi / 2)))

    @property
    def major(self) -> float:
        return 2 * max(self.a, self.b)

    @property
    def mean_r(self) -> float:
        return (self.a + self.b) / 2

    def scaled(self, k: float) -> 'Ellipse':
        return Ellipse(self.cx, self.cy, self.a * k, self.b * k, self.angle)


def rim_candidates(img: np.ndarray, guess: Ellipse, lo: float, hi: float, rays: int, pick: str = 'outermost') -> tuple[np.ndarray, np.ndarray]:
    """
    Rim candidates on `rays` rays from the guess's centre, between lo and hi times its outline: on each ray the
    outermost strong brightness step (a plate's rim is its outermost circle; rings on its face are inside), the
    strongest, or `all` strong ones. Returns points (n, 2) and the ray each came from.
    """
    theta = np.linspace(0, 2 * np.pi, rays, endpoint=False)
    r_out = guess.radius_towards(theta)
    m = int(np.clip((hi - lo) * guess.mean_r / 0.5, 12, 200))
    k = np.linspace(lo, hi, m)
    R = r_out[:, None] * k[None, :]
    X = (guess.cx + R * np.cos(theta)[:, None]).astype(np.float32)
    Y = (guess.cy + R * np.sin(theta)[:, None]).astype(np.float32)
    prof = cv2.remap(img, X, Y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    dr = (R[:, 1] - R[:, 0])[:, None]
    D = np.abs(np.gradient(prof, axis=1)) / dr
    pts, ray_ids = [], []
    for i in range(rays):
        d = D[i]
        top = d.max()
        if top < 2.0:  # grey levels per pixel: no edge worth the name on this ray
            continue
        peaks = np.flatnonzero((d[1:-1] >= d[:-2]) & (d[1:-1] > d[2:]) & (d[1:-1] >= 0.3 * top)) + 1
        if len(peaks) == 0:
            continue
        chosen = [peaks[-1]] if pick == 'outermost' else [peaks[np.argmax(d[peaks])]] if pick == 'strongest' else list(peaks[np.argsort(-d[peaks])][:8])
        for j in chosen:
            den = d[j - 1] - 2 * d[j] + d[j + 1]
            off = 0.5 * (d[j - 1] - d[j + 1]) / den if den < 0 else 0.0
            r = R[i, j] + float(np.clip(off, -0.5, 0.5)) * dr[i, 0]
            pts.append((guess.cx + r * math.cos(theta[i]), guess.cy + r * math.sin(theta[i])))
            ray_ids.append(i)
    return np.array(pts, np.float32).reshape(-1, 2), np.array(ray_ids, int)


def ransac_ellipse(pts: np.ndarray, ray_ids: np.ndarray, rng: np.random.Generator, tol: float, iters: int = 150, min_ratio: float = MIN_AXIS_RATIO) -> tuple[Ellipse | None, np.ndarray]:
    """The ellipse the most rays have a rim candidate on (within tol px), refitted on its inliers."""
    n = len(pts)
    if n < 8:
        return None, np.zeros(n, bool)

    def support(inl):
        return len(np.unique(ray_ids[inl]))

    best, best_in, best_s = None, np.zeros(n, bool), 0
    n_rays = len(np.unique(ray_ids))
    for _ in range(iters):
        idx = rng.choice(n, 5, replace=False)
        try:
            e = Ellipse.from_cv(cv2.fitEllipse(pts[idx]))
        except cv2.error:
            continue
        if not (e.a > 3 and e.b > 3) or min(e.a, e.b) / max(e.a, e.b) < min_ratio:
            continue
        inl = e.distance(pts) < tol
        s_ = support(inl)
        if s_ > best_s:
            best, best_in, best_s = e, inl, s_
            if s_ > 0.9 * n_rays:
                break
    if best is None or best_s < 6:
        return None, best_in
    for _ in range(2):  # refit on the inliers, then take the inliers of the refit
        e = Ellipse.from_cv(cv2.fitEllipseDirect(pts[best_in]))
        inl = e.distance(pts) < tol
        if support(inl) < 6:
            break
        best, best_in = e, inl
    return best, best_in


def fit_rim(img: np.ndarray, guess: Ellipse, lo: float, hi: float, rng: np.random.Generator, rays: int = 120, pick: str = 'outermost', iters: int = 150):
    """Rim ellipse near `guess`, the share of rays that agree with it, and its RMS distance to them (px)."""
    pts, ids = rim_candidates(img, guess, lo, hi, rays, pick)
    tol = max(0.9, 0.012 * guess.mean_r)
    e, inl = ransac_ellipse(pts, ids, rng, tol, iters)
    if e is None:
        return None, 0.0, float('inf')
    rms = float(np.sqrt(np.mean(e.distance(pts[inl]) ** 2)))
    return e, len(np.unique(ids[inl])) / rays, rms


def locate_plate(gray: np.ndarray, hint: tuple[float, float, float] | None, rng: np.random.Generator) -> tuple[Ellipse | None, float]:
    """
    The plate's rim in the first frame, from a rough hint (centre and radius within ~20 %) or by Hough circles. A
    plate face is a family of concentric rings (rim, lip, logo band, hub), any of which can be the strongest edge;
    every ring the rays agree on is found in turn and the outermost of the family is the rim.
    """
    img = cv2.GaussianBlur(gray, (0, 0), 1.5).astype(np.float32)
    if hint is None:
        small = cv2.medianBlur(gray, 5)
        circles = cv2.HoughCircles(small, cv2.HOUGH_GRADIENT, dp=1.5, minDist=gray.shape[1] / 8, param1=120, param2=40, minRadius=int(gray.shape[1] * 0.06), maxRadius=int(gray.shape[1] * 0.35))
        cands = [] if circles is None else [tuple(c) for c in circles[0][:8]]
    else:
        cands = [hint]
    rays = 120
    best = (None, 0.0)
    for cx, cy, r in cands:
        pts, ids = rim_candidates(img, Ellipse(cx, cy, r, r, 0), 0.55, 1.5, rays, 'all')
        left = np.ones(len(pts), bool)
        rings: list[tuple[Ellipse, float]] = []
        for _ in range(6):
            idx = np.flatnonzero(left)
            e, inl = ransac_ellipse(pts[idx], ids[idx], rng, max(1.0, 0.015 * r), iters=400)
            if e is None:
                break
            sup = len(np.unique(ids[idx][inl])) / rays
            if sup < 0.25:
                break
            rings.append((e, sup))
            left[idx[inl]] = False
        if not rings:
            continue
        ref = max(rings, key=lambda x: x[1])[0]
        family = [(e, sup) for e, sup in rings if np.hypot(e.cx - ref.cx, e.cy - ref.cy) < 0.15 * ref.mean_r and 0.65 * r < e.mean_r < 1.4 * r]
        if not family:
            continue
        e, frac = max(family, key=lambda x: x[0].mean_r)
        # A ring just outside, if the rays agree on one, is the rim: the lip or a bevel can outshine it on a dark wall.
        for _ in range(2):
            out, f_out, _ = fit_rim(img, e, 1.02, 1.12, rng, rays, 'outermost', iters=300)
            if out is None or f_out < 0.35 or np.hypot(out.cx - e.cx, out.cy - e.cy) > 0.05 * e.mean_r or out.mean_r <= e.mean_r:
                break
            e, frac = out, f_out
        e2, frac2, _ = fit_rim(img, e, 0.97, 1.03, rng, rays, 'outermost', iters=300)
        if e2 is not None and frac2 > 0.3 and abs(e2.mean_r / e.mean_r - 1) < 0.03:
            e, frac = e2, frac2
        if frac > best[1]:
            best = (e, frac)
    return best


# ---------------------------------------------------------------------------------------------------------------
# Tracking
# ---------------------------------------------------------------------------------------------------------------


def track(video: str, hint: tuple[float, float, float] | None = None, log=None, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    began = time.time()
    pts = frame_pts(video)
    cap = cv2.VideoCapture(video)
    ok, frame = cap.read()
    if not ok:
        return {'tracker': 'opencv', 'error': 'cannot decode video'}
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    e0, frac0 = locate_plate(gray, hint, rng)
    if e0 is None:
        return {'tracker': 'opencv', 'error': 'plate not found in the first frame'}
    ref_axes = [(e0.a, e0.b)]
    e = e0
    samples, chords = [], []
    pos_ms = []
    lost = False
    prev = gray
    prev_c = np.array([e.cx, e.cy])
    vel = np.zeros(2)  # px per second of file time
    last_t = None
    template = None
    tmiss = 0
    idx = 0
    while True:
        if idx > 0:
            ok, frame = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        pos_ms.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000)
        t = float(pts[idx]) if idx < len(pts) else pos_ms[-1]
        img = cv2.GaussianBlur(gray, (0, 0), 1.0).astype(np.float32)
        conf = 0.0
        if idx == 0:
            c_new, conf = np.array([e.cx, e.cy]), 0.6 + 0.4 * frac0
        else:
            dt = t - last_t if last_t is not None else 0
            pred = prev_c + vel * dt
            lk = flow_step(prev, gray, e, prev_c, pred)
            guess_c = lk[0] if lk is not None else pred
            a_ref, b_ref = np.median(np.array(ref_axes[-30:]), axis=0)
            guess = Ellipse(float(guess_c[0]), float(guess_c[1]), a_ref, b_ref, e.angle)
            shift = 0 if lk is not None else np.hypot(*(pred - prev_c)) * 0.3
            band = 0.06 + shift / guess.mean_r
            fit, frac, rms = fit_rim(img, guess, 1 - band, 1 + band, rng, rays=96, iters=80)
            consistent = fit is not None and abs(fit.mean_r / guess.mean_r - 1) < 0.05 and np.hypot(fit.cx - guess.cx, fit.cy - guess.cy) < max(3.0, 0.15 * guess.mean_r)
            if consistent and frac >= 0.35 and rms < 1.5:
                e = fit
                c_new, conf = np.array([fit.cx, fit.cy]), 0.6 + 0.4 * min(1.0, frac)
                ref_axes.append((fit.a, fit.b))
            elif lk is not None:
                c_new, conf = lk[0], 0.55
                e = Ellipse(float(c_new[0]), float(c_new[1]), a_ref, b_ref, e.angle)
            else:
                m = template_step(gray, template, pred, e)
                if m is not None and m[1] > 0.6:
                    c_new, conf = m[0], 0.5
                    e = Ellipse(float(c_new[0]), float(c_new[1]), a_ref, b_ref, e.angle)
                else:
                    c_new, conf = pred, 0.0
            if dt > 0 and conf >= 0.5:
                vel = 0.5 * vel + 0.5 * (c_new - prev_c) / dt
        if conf >= 0.5:
            template = grab_template(gray, e)
            tmiss = 0
            prev_c = c_new
            last_t = t
        else:
            tmiss += 1
            if tmiss > 15:
                lost = True
                break
        samples.append([round(t, 6), round(float(c_new[0]), 3), round(float(c_new[1]), 3), round(conf, 3)])
        chords.append(round(e.vertical, 3) if conf >= 0.6 else None)
        prev = gray
        idx += 1
    cap.release()
    good_d = [d for d, s in zip(chords, samples) if d is not None and s[0] - samples[0][0] <= 0.5]
    pos = np.array(pos_ms[: len(pts)])
    disagree = float(np.max(np.abs(pos - pts[: len(pos)]))) if len(pos) else 0.0
    out = {
        'tracker': 'opencv',
        'video': video.split('/')[-1],
        'samples': samples,
        'd': chords,
        'diameter': float(np.median(good_d)) if good_d else e0.vertical,
        'lost': lost,
        'ellipse0': {'cx': e0.cx, 'cy': e0.cy, 'major': e0.major, 'minor': 2 * min(e0.a, e0.b), 'angle': e0.angle, 'vertical': e0.vertical},
        'frames_container': int(len(pts)),
        'frames_decoded': int(idx),
        'pos_msec_vs_pts_max_s': disagree,
        'ms': int((time.time() - began) * 1000),
    }
    if log:
        log(f"  opencv tracker {out['video']}: {len(samples)} frames, lost={lost}, diameter {out['diameter']:.1f} px, {out['ms'] / 1000:.0f} s")
    return out


def flow_step(prev: np.ndarray, gray: np.ndarray, e: Ellipse, prev_c: np.ndarray, pred: np.ndarray):
    """Plate centre in `gray` by Lucas–Kanade flow of corners on the plate face, or None."""
    h, w = gray.shape
    R = max(e.a, e.b)
    mask = np.zeros_like(prev)
    cv2.ellipse(mask, ((e.cx, e.cy), (2 * e.a * 0.85, 2 * e.b * 0.85), e.angle), 255, -1)
    cv2.circle(mask, (int(e.cx), int(e.cy)), int(R * 0.12), 0, -1)  # the sleeve end doesn't turn with the plate
    x0, y0 = int(max(0, e.cx - R)), int(max(0, e.cy - R))
    x1, y1 = int(min(w, e.cx + R + 1)), int(min(h, e.cy + R + 1))
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None
    p0 = cv2.goodFeaturesToTrack(prev[y0:y1, x0:x1], 80, 0.01, max(3, R / 15), mask=mask[y0:y1, x0:x1], blockSize=5)
    if p0 is None or len(p0) < 8:
        return None
    p0 = p0.reshape(-1, 2) + (x0, y0)
    guess = (p0 + (pred - prev_c)).astype(np.float32)
    lk = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01), flags=cv2.OPTFLOW_USE_INITIAL_FLOW)
    p1, st, _ = cv2.calcOpticalFlowPyrLK(prev, gray, p0.astype(np.float32), guess.copy(), **lk)
    if p1 is None:
        return None
    p0b, st2, _ = cv2.calcOpticalFlowPyrLK(gray, prev, p1, p0.astype(np.float32).copy(), **lk)
    good = (st.ravel() == 1) & (st2.ravel() == 1) & (np.hypot(*(p0b - p0).T) < 0.7)
    if good.sum() < 6:
        return None
    M, inl = cv2.estimateAffinePartial2D(p0[good], p1[good], method=cv2.RANSAC, ransacReprojThreshold=1.0)
    if M is None or inl.sum() < 6:
        return None
    c = M @ np.array([prev_c[0], prev_c[1], 1.0])
    return c, int(inl.sum())


def grab_template(gray: np.ndarray, e: Ellipse) -> tuple[np.ndarray, int] | None:
    """The square inside the plate face (no background in it), for the template fallback."""
    half = int(min(e.a, e.b) * 0.6)
    x, y = int(round(e.cx)), int(round(e.cy))
    if half < 6 or x - half < 0 or y - half < 0 or x + half + 1 > gray.shape[1] or y + half + 1 > gray.shape[0]:
        return None
    return gray[y - half : y + half + 1, x - half : x + half + 1].copy(), half


def template_step(gray: np.ndarray, template, pred: np.ndarray, e: Ellipse):
    if template is None:
        return None
    tpl, half = template
    s = int(max(e.a, e.b) * 0.8) + half
    x, y = int(round(pred[0])), int(round(pred[1]))
    x0, y0 = max(0, x - s), max(0, y - s)
    roi = gray[y0 : y + s + 1, x0 : x + s + 1]
    if roi.shape[0] <= tpl.shape[0] or roi.shape[1] <= tpl.shape[1]:
        return None
    res = cv2.matchTemplate(roi, tpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    return np.array([x0 + loc[0] + half, y0 + loc[1] + half], float), float(score)


# ---------------------------------------------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------------------------------------------


def butter_lowpass(x: np.ndarray, fs: float, cutoff: float, order: int = 2) -> np.ndarray:
    """Zero-lag Butterworth low-pass: `order` forwards and backwards, cutoff corrected for the double pass (Winter)."""
    corr = (2 ** 0.5 - 1) ** (1 / (2 * order))
    wn = min(0.95, cutoff / corr / (fs / 2))
    b, a = signal.butter(order, wn)
    pad = min(len(x) - 1, int(3 * fs / cutoff))
    return signal.filtfilt(b, a, x, padtype='odd', padlen=pad)


def height_model(y: np.ndarray, d: np.ndarray | None, diameter: float, perspective: bool) -> tuple:
    """Height (m, up positive, 0 at the first sample) of each image y, and how it was scaled."""
    y0 = y[0]
    if perspective and d is not None:
        ok = np.isfinite(d)
        if ok.sum() >= 20 and np.ptp(y[ok]) > 0.5 * np.nanmedian(d):
            slope, icpt, _, _ = stats.theilslopes(d[ok], y[ok])
            span = np.ptp(y[ok])
            if abs(slope) * span / np.nanmedian(d) < 0.25:
                # chord(y) = icpt + slope·y px for 0.45 m, so dh = −0.45·dy / chord(y), integrated exactly.
                if abs(slope) < 1e-9:
                    return -(y - y0) * PLATE_D / icpt, {'kind': 'chord', 'px': float(icpt)}
                h = -(PLATE_D / slope) * np.log((icpt + slope * y) / (icpt + slope * y0))
                return h, {'kind': 'chord-vs-y', 'intercept': float(icpt), 'slope': float(slope), 'px_at_start': float(icpt + slope * y0)}
        if ok.sum() >= 5:
            px = float(np.nanmedian(d[ok]))
            return -(y - y0) * PLATE_D / px, {'kind': 'chord-median', 'px': px}
    return -(y - y0) * PLATE_D / diameter, {'kind': 'diameter', 'px': float(diameter)}


def analyse(
    data: dict,
    time_scale: float | None = None,
    cutoff: float = 6.0,
    order: int = 2,
    edge_cutoff: float | None = None,
    min_conf: float = 0.5,
    perspective: bool = True,
    fs: float = 200.0,
) -> dict:
    """Reps from a samples file (either tracker). Times in the result are real seconds."""
    if data.get('error') or not data.get('samples'):
        return {'analyser': 'reference', 'error': data.get('error', 'no samples'), 'reps': []}
    ts = time_scale if time_scale is not None else data.get('time_scale', 1.0)
    S = np.array(data['samples'], float)
    t_all, x_all, y_all, c_all = S[:, 0] * ts, S[:, 1], S[:, 2], S[:, 3]
    d_all = np.array([np.nan if v is None else v for v in data['d']], float) if data.get('d') else None
    keep = c_all >= min_conf
    if keep.sum() < 10:
        return {'analyser': 'reference', 'error': 'too few confident frames', 'reps': []}
    t, x, y = t_all[keep], x_all[keep], y_all[keep]
    d = d_all[keep] if d_all is not None else None
    # Duplicate timestamps (a tracker sampling the same frame twice) would break the spline.
    t, uniq = np.unique(t, return_index=True)
    x, y = x[uniq], y[uniq]
    d = d[uniq] if d is not None else None
    h, scale = height_model(y, d, data['diameter'], perspective)
    px_x = scale.get('px_at_start', scale.get('px', data['diameter']))
    xm = (x - x[0]) * PLATE_D / px_x
    dts = np.diff(t)
    frame_dt = float(np.median(dts))
    gap_at = np.flatnonzero(dts > max(3.5 * frame_dt, 0.1))
    gaps = [(float(t[i]), float(t[i + 1])) for i in gap_at]

    grid = np.arange(t[0], t[-1], 1 / fs)
    hg = interpolate.CubicSpline(t, h)(grid)
    xg = np.interp(grid, t, xm)
    cutoff_used = min(cutoff, 0.4 / frame_dt / 2)
    hf = butter_lowpass(hg, fs, cutoff_used, order)
    v = np.gradient(hf, 1 / fs)
    a = np.gradient(v, 1 / fs)
    ec = edge_cutoff if edge_cutoff is not None else min(2.5 * cutoff_used, 0.35 / frame_dt)
    ve = np.gradient(butter_lowpass(hg, fs, ec, order), 1 / fs) if ec > cutoff_used else v

    reps = []
    for r in kinematics.concentric_phases(grid, hf, v, a):
        r = refine_ends(grid, hf, v, ve, a, r)
        flags = []
        if not r['complete'] or r['start'] - t[0] < 0.05 or t[-1] - r['end'] < 0.05:
            flags.append('truncated')
        if any(g0 < r['end'] + 0.05 and g1 > r['start'] - 0.05 for g0, g1 in gaps):
            flags.append('gap')
        inside = (t_all >= r['start']) & (t_all <= r['end'])
        if inside.sum() and (c_all[inside] < min_conf).mean() > 0.2:
            flags.append('unsure')
        sel = (grid >= r['start']) & (grid <= r['end'])
        if sel.any() and np.ptp(xg[sel]) > max(0.15, 0.5 * r['rom']):
            flags.append('drift')
        if r['mcv'] > 2.5 or r['pv'] > 4.5 or r['end'] - r['start'] < 0.15:
            flags.append('implausible')
        r['flags'] = flags
        reps.append(r)
    whole = [r['rom'] for r in reps if 'truncated' not in r['flags']]
    if len(whole) >= 2:
        typical = float(np.median(whole))
        for r in reps:
            if r['rom'] < 0.7 * typical:
                r['flags'].append('partial')
    out_reps = [
        {
            'start': r['start'],
            'end': r['end'],
            'prop_end': r['prop_end'],
            'mcv': r['mcv'],
            'mpv': r['mpv'],
            'pv': r['pv'],
            'rom': r['rom'],
            'valid': not r['flags'],
            'reason': ','.join(r['flags']) or None,
        }
        for r in reps
    ]
    return {
        'analyser': 'reference',
        'cutoff_hz': cutoff_used,
        'edge_cutoff_hz': ec,
        'order': order,
        'scale': scale,
        'rate': 1 / frame_dt,
        'gaps': gaps,
        'reps': out_reps,
    }


def refine_ends(t: np.ndarray, h: np.ndarray, v: np.ndarray, ve: np.ndarray, a: np.ndarray, r: dict, window: float = 0.15) -> dict:
    """
    Puts a rep's start and end where the bar's velocity reaches zero, without the filter's rounding. The lighter-
    filtered velocity `ve` is close to a straight line where the bar speeds up off the bottom and slows into the top,
    but bent by the filter right at the corners; so a line is fitted to it between 15 % and 50 % of peak velocity
    on each side and extended to zero. Falls back to the plain zero crossing when there is no clean ramp, and never
    moves an end more than `window` s.
    """
    pv = r['pv']
    inside = np.flatnonzero((t >= r['start']) & (t <= r['end']))
    if len(inside) < 5 or pv <= 0:
        return r
    k = inside[np.argmax(ve[inside])]
    lo_v, hi_v = 0.15 * pv, 0.5 * pv

    def line_zero(idx: np.ndarray) -> float | None:
        if len(idx) < 4:
            return None
        slope, icpt = np.polyfit(t[idx], ve[idx], 1)
        return None if slope == 0 else float(-icpt / slope)

    # Start: the first climb from 15 % to 50 % after the filtered start.
    first = inside[0]
    up = np.flatnonzero(ve[first:k + 1] >= hi_v)
    start = r['start']
    if len(up):
        top = first + up[0]
        j = top
        while j > first and ve[j - 1] >= lo_v and ve[j - 1] <= ve[j]:
            j -= 1
        z = line_zero(np.arange(j, top + 1))
        if z is not None and abs(z - r['start']) <= window and z < t[k]:
            start = z
    # End: the last fall from 50 % to 15 % before the filtered end.
    last = inside[-1]
    down = np.flatnonzero(ve[k:last + 1] >= hi_v)
    end = r['end']
    if len(down):
        top = k + down[-1]
        j = top
        while j < last and ve[j + 1] >= lo_v and ve[j + 1] <= ve[j]:
            j += 1
        z = line_zero(np.arange(top, j + 1))
        if z is not None and abs(z - r['end']) <= window and z > t[k]:
            end = z
    if end - start <= 0:
        return r
    # The bar is all but still at both ends: the extremes of the height there are the bottom and the top.
    near_s = (t >= start - 0.05) & (t <= start + 0.02)
    near_e = (t >= end - 0.02) & (t <= end + 0.05)
    hs = float(h[near_s].min()) if near_s.any() else float(np.interp(start, t, h))
    he = float(h[near_e].max()) if near_e.any() else float(np.interp(end, t, h))
    rom = he - hs
    prop_end = min(max(r['prop_end'], start), end)
    hp = float(np.interp(prop_end, t, h))
    mpv = (hp - hs) / (prop_end - start) if start < prop_end < end else rom / (end - start)
    return {**r, 'start': start, 'end': end, 'rom': rom, 'mcv': rom / (end - start), 'mpv': mpv, 'prop_end': prop_end}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    tr = sub.add_parser('track')
    tr.add_argument('video')
    tr.add_argument('--hint', help='x,y,r of the plate in the first frame, roughly; Hough circles if left out')
    tr.add_argument('--out')
    an = sub.add_parser('analyse')
    an.add_argument('samples')
    an.add_argument('--time-scale', type=float)
    an.add_argument('--cutoff', type=float, default=6.0)
    an.add_argument('--edge-cutoff', type=float)
    an.add_argument('--order', type=int, default=2)
    an.add_argument('--no-perspective', action='store_true')
    an.add_argument('--out')
    a = ap.parse_args()
    if a.cmd == 'track':
        hint = tuple(float(v) for v in a.hint.split(',')) if a.hint else None
        res = track(a.video, hint, log=lambda m: print(m, file=sys.stderr))
    else:
        with open(a.samples) as fh:
            data = json.load(fh)
        res = analyse(data, a.time_scale, a.cutoff, a.order, a.edge_cutoff, perspective=not a.no_perspective)
    text = json.dumps(res)
    if a.out:
        with open(a.out, 'w') as fh:
            fh.write(text)
    else:
        print(json.dumps(res, indent=1) if a.cmd == 'analyse' else text)


if __name__ == '__main__':
    main()
