#!/usr/bin/env python3
"""
Synthetic side-view squat videos with exact ground truth, for validating bar tracking and velocity analysis.

Each video is one set filmed by a phone on a tripod. The bar's vertical path is built from velocity profiles (a fast
reversal at the bottom like a stretch-shortening bounce, deceleration into lockout, paused reps, touch-and-go reps,
slow grinders with a sticking point) on a 2 kHz grid, so velocity is known exactly rather than differentiated. A
45 cm plate with a realistic face is put in that path in 3-D and projected through a pinhole camera that can be
yawed off the bar axis (the plate becomes an ellipse), pitched and rolled, onto a cluttered gym. Then everything a
phone adds: motion blur from the exposure, camera shake, lighting drift, sensor noise, H.264 compression, a body part
passing in front of the plate, the plate turning on the sleeve, and frame timestamps that are irregular (variable
frame rate, written into the container so the decoder reports them) or slowed down (a slow-motion clip exported at
30 fps).

Next to each `<name>.mp4` goes `<name>.json` with the ground truth: per frame the file timestamp, the real time, the
true plate centre in video pixels, height and velocity; per rep MCV, MPV, PV and ROM computed from the exact
trajectory with the phase definitions in kinematics.py.

Usage:
  python3 synth.py --out DIR [--size quick|full|<n>] [--jobs 4]   render a dataset (skips videos already there)
  python3 synth.py --out DIR --only q03 [--preview]               one video, or PNGs of a few of its frames
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import cv2
import numpy as np

import kinematics

PLATE_D = 0.45
#: Step of the motion grid, s.
DT = 0.0005
#: Plate sprite radius, px.
SPRITE_R = 240
#: Container time base of variable-frame-rate files (ticks per second).
VFR_TB = 90000


@dataclasses.dataclass
class Spec:
    name: str
    seed: int
    style: str  # bounce | paused | tng | grinder
    mcv: list[float]  # target mean concentric velocity of each rep, m/s
    rom: float = 0.55  # m
    fps: int = 60  # capture frame rate
    vfr: bool = False  # irregular timestamps: jitter, dropped frames, a stretch at half rate
    slowmo: bool = False  # captured at `fps`, exported as a 30 fps file (time runs fps/30 times slower)
    width: int = 720
    height: int = 1280
    yaw: float = 0.0  # deg between the bar axis and the camera's optical axis
    pitch: float = 0.0  # deg, camera tilted up
    roll: float = 0.0  # deg
    distance: float = 3.0  # camera to plate, m
    occlusion: float = 0.0  # how far into the plate (share of its radius) an arm reaches at most
    noise: float = 3.0  # sensor noise SD, grey levels
    crf: int = 23
    shake: float = 1.0  # camera shake amplitude, px
    light: float = 0.05  # lighting drift amplitude, share of brightness
    shutter: float = 0.5  # exposure as a share of the frame interval (at most 1/60 s)
    motion_seed: int | None = None  # a retest twin shares its original's motion
    retest_of: str | None = None

    @property
    def file_fps(self) -> int:
        return 30 if self.slowmo else self.fps

    @property
    def time_scale(self) -> float:
        """Real seconds per second of file time, as `timeScale` in barPath.ts."""
        return self.file_fps / self.fps if self.slowmo else 1.0


# ---------------------------------------------------------------------------------------------------------------
# Motion
# ---------------------------------------------------------------------------------------------------------------


def _shape(kind: str, p: dict) -> tuple[np.ndarray, np.ndarray]:
    """Velocity shape f(τ) on [0, 1] with ∫f = 1, and its integral F, on a fine grid."""
    tau = np.linspace(0, 1, 8001)
    if kind == 'con':
        f = tau ** p['alpha'] * (1 - tau) ** p['beta']
        if p.get('dip'):
            # The sticking point: the bar slows to a crawl a third of the way up, then speeds up again.
            f = f * (1 - p['dip'] * np.exp(-(((tau - p['dip_at']) / p['dip_w']) ** 2)))
    else:
        f = tau ** p['alpha'] * (1 - tau) ** p['beta']
    F = np.concatenate([[0], np.cumsum((f[1:] + f[:-1]) / 2 * (tau[1] - tau[0]))])
    return f / F[-1], F / F[-1]


def build_motion(spec: Spec) -> dict:
    """The bar's world trajectory on the DT grid: height above the floor, sagittal sway and plate rotation."""
    rng = np.random.default_rng(spec.motion_seed if spec.motion_seed is not None else spec.seed)
    segs: list[tuple[str, float, float, dict]] = []  # kind, duration, distance, shape params
    segs.append(('rest', rng.uniform(0.7, 1.0), 0, {}))
    n = len(spec.mcv)
    for i, mcv in enumerate(spec.mcv):
        rom = spec.rom * (1 + rng.normal(0, 0.012))
        fast = mcv > 1.0
        if spec.style == 'tng':
            ecc_v = rng.uniform(0.6, 0.9)
            ecc = {'alpha': 1.0 if i > 0 else 1.6, 'beta': 1.0}
        elif spec.style == 'paused':
            ecc_v = rng.uniform(0.4, 0.6)
            ecc = {'alpha': 1.6, 'beta': 2.0}
        elif spec.style == 'grinder':
            ecc_v = rng.uniform(0.35, 0.5)
            ecc = {'alpha': 1.6, 'beta': 1.6}
        else:
            ecc_v = rng.uniform(0.5, 0.8)
            ecc = {'alpha': 1.6, 'beta': 1.0}  # still moving fast into the bottom: a bounce
        segs.append(('ecc', rom / ecc_v, -rom, ecc))
        if spec.style == 'paused':
            segs.append(('rest', rng.uniform(0.8, 1.5), 0, {}))
        # Velocity rises from the turnaround and falls into lockout roughly linearly; lighter, faster reps brake harder.
        con = {'alpha': rng.uniform(1.0, 1.2), 'beta': rng.uniform(0.9, 1.05) if fast else rng.uniform(1.0, 1.2)}
        if spec.style == 'paused':
            con['alpha'] = rng.uniform(1.2, 1.5)  # force builds from a dead stop
        if spec.style == 'grinder':
            con.update(alpha=1.25, beta=rng.uniform(1.05, 1.25), dip=rng.uniform(0.55, 0.8), dip_at=rng.uniform(0.3, 0.45), dip_w=0.1)
        if spec.style == 'tng' and i < n - 1:
            con['beta'] = 1.0  # turns straight into the next descent
        segs.append(('con', rom / mcv, rom, con))
        if spec.style != 'tng' or i == n - 1:
            segs.append(('rest', rng.uniform(0.5, 1.1) if i < n - 1 else rng.uniform(0.8, 1.1), 0, {}))

    total = sum(d for _, d, _, _ in segs)
    t = np.arange(0, total + DT / 2, DT)
    y_top = rng.uniform(1.38, 1.5)
    h = np.full_like(t, y_top)
    v = np.zeros_like(t)
    t0, level = 0.0, y_top
    for kind, dur, dist, p in segs:
        sel = (t >= t0) & (t <= t0 + dur)
        if kind != 'rest':
            f, F = _shape(kind, p)
            tau = (t[sel] - t0) / dur
            grid = np.linspace(0, 1, len(f))
            h[sel] = level + dist * np.interp(tau, grid, F)
            v[sel] = dist / dur * np.interp(tau, grid, f)
        else:
            h[sel] = level
            v[sel] = 0
        level += dist
        t0 += dur
    h[t > t0] = level
    a = np.gradient(v, DT)
    depth = (y_top - h) / spec.rom
    sway = rng.uniform(0.015, 0.045) * depth + 0.006 * np.sin(2 * np.pi * t / rng.uniform(2.5, 4.5) + rng.uniform(0, 6))
    rot = rng.uniform(0, 360) + rng.uniform(-20, 20) * depth + rng.uniform(-3, 3) * t
    reps = kinematics.concentric_phases(t, h, v, a)
    if len(reps) != n:
        raise RuntimeError(f'{spec.name}: built {n} reps but the phase rules find {len(reps)}')
    return {'t': t, 'h': h, 'v': v, 'a': a, 'sway': sway, 'rot': rot, 'y_top': y_top, 'reps': reps, 'duration': total}


# ---------------------------------------------------------------------------------------------------------------
# Frame timestamps
# ---------------------------------------------------------------------------------------------------------------


def frame_times(spec: Spec, duration: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, str | None]:
    """
    Real exposure-centre time and file timestamp of every frame, and for a variable-rate file the ffmpeg setpts
    expression that writes exactly those timestamps (ffmpeg evaluates the same formula, so nothing is resampled).
    """
    if not spec.vfr:
        n = int((duration - 0.02) * spec.fps)
        real = np.arange(n) / spec.fps
        return real, real / spec.time_scale, None
    T0 = 1 / spec.fps
    # Jitter of up to ±15 % of a frame, a dropped frame now and then, and a stretch at half rate (low light).
    amp = rng.uniform(0.08, 0.15) * T0
    w1, w2 = rng.uniform(1.1, 2.9), rng.uniform(0.17, 0.43)
    nominal = int(duration * spec.fps)
    drops = sorted(int(d) for d in rng.choice(np.arange(5, nominal), size=max(1, nominal // 40), replace=False))
    s0 = int(rng.uniform(0.3, 0.6) * nominal)
    slow = int(rng.uniform(0.15, 0.3) * nominal)
    terms = [f'N*{T0!r}', f'{amp!r}*sin(N*{w1!r})*sin(N*{w2!r})']
    terms += [f'gte(N,{d})*{T0!r}' for d in drops]
    terms += [f'clip(N-{s0},0,{slow})*{T0!r}', f'{0.5 / VFR_TB!r}']
    expr = '+'.join(terms)

    def at(N: int) -> float:
        x = N * T0 + amp * math.sin(N * w1) * math.sin(N * w2) + sum(T0 for d in drops if N >= d)
        x += min(max(N - s0, 0), slow) * T0 + 0.5 / VFR_TB
        return int(x * VFR_TB) / VFR_TB

    pts = []
    N = 0
    while True:
        x = at(N)
        if x > duration - 0.02:
            break
        pts.append(x)
        N += 1
    pts_a = np.array(pts)
    return pts_a, pts_a, expr


# ---------------------------------------------------------------------------------------------------------------
# Scene: camera, plate, background, body
# ---------------------------------------------------------------------------------------------------------------


def _rx(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _rz(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


class Camera:
    """Pinhole camera; world X right, Y up, Z away from the camera."""

    def __init__(self, w: int, h: int, vfov_deg: float, pitch: float, roll: float, pos: np.ndarray):
        self.f = (h / 2) / math.tan(math.radians(vfov_deg) / 2)
        self.K = np.array([[self.f, 0, w / 2], [0, self.f, h / 2], [0, 0, 1]])
        # World → camera: flip Y (image rows grow downwards), then tilt up by `pitch` and roll.
        self.R = _rz(math.radians(roll)) @ _rx(-math.radians(pitch)) @ np.diag([1.0, -1.0, 1.0])
        self.pos = pos

    def project(self, P: np.ndarray) -> np.ndarray:
        """World points (…, 3) → image points (…, 2)."""
        c = (np.asarray(P) - self.pos) @ self.R.T
        p = c @ self.K.T
        return p[..., :2] / p[..., 2:3]

    def depth(self, P: np.ndarray) -> np.ndarray:
        return ((np.asarray(P) - self.pos) @ self.R.T)[..., 2]


def make_plate_sprite(rng: np.random.Generator) -> np.ndarray:
    """A 45 cm bumper face (premultiplied BGRA float32): rubber, bevelled rim, raised lip, logo, steel hub."""
    k = 2  # drawn at twice the size, then shrunk, for smooth edges
    R = SPRITE_R * k
    S = 2 * R + 16 * k
    c = S // 2
    theme = rng.choice(['black', 'black', 'blue', 'red', 'green', 'grey'])
    body = {
        'black': (34, 33, 36),
        'blue': (150, 80, 25),
        'red': (40, 40, 170),
        'green': (60, 130, 40),
        'grey': (140, 140, 138),
    }[theme]
    accent = [(200, 120, 30), (40, 40, 210), (40, 200, 230), (235, 235, 235)][rng.integers(4)] if theme == 'black' else (235, 235, 235)
    img = np.zeros((S, S, 3), np.uint8)
    alpha = np.zeros((S, S), np.uint8)
    cv2.circle(alpha, (c, c), R, 255, -1, cv2.LINE_AA)
    lighter = tuple(int(min(255, x * 1.35 + 18)) for x in body)
    darker = tuple(int(x * 0.75) for x in body)
    cv2.circle(img, (c, c), R, tuple(int(min(255, x * 1.12 + 6)) for x in body), -1, cv2.LINE_AA)  # rounded edge
    cv2.circle(img, (c, c), int(R * 0.99), body, -1, cv2.LINE_AA)
    cv2.circle(img, (c, c), int(R * 0.935), lighter, max(2, int(R * 0.012)), cv2.LINE_AA)  # raised lip
    cv2.circle(img, (c, c), int(R * 0.905), darker, max(2, int(R * 0.01)), cv2.LINE_AA)
    # Rubber flecks and scuffs.
    for _ in range(500):
        a, r = rng.uniform(0, 2 * np.pi), R * math.sqrt(rng.uniform(0.06, 0.8))
        col = tuple(int(np.clip(x + rng.normal(0, 18), 0, 255)) for x in body)
        cv2.circle(img, (int(c + r * math.cos(a)), int(c + r * math.sin(a))), int(rng.integers(1, 4) * k), col, -1)
    # Logo: a coloured band and lettering, kg mark on the opposite side.
    cv2.ellipse(img, (c, c), (int(R * 0.62), int(R * 0.62)), 0, 200, 340, accent, int(R * 0.07), cv2.LINE_AA)
    font = cv2.FONT_HERSHEY_DUPLEX
    for text, (dx, dy), scale in [('OLYMPIC', (-0.42, -0.28), 1.6), ('20', (-0.2, 0.62), 3.6), ('KG', (0.28, 0.62), 1.7), ('IWF', (0.36, 0.12), 1.2)]:
        cv2.putText(img, text, (int(c + dx * R), int(c + dy * R)), font, scale * k * R / 480, accent, int(3 * k * R / 480) + 1, cv2.LINE_AA)
    # Steel hub with bolts and the sleeve hole.
    cv2.circle(img, (c, c), int(R * 0.24), (176, 176, 182), -1, cv2.LINE_AA)
    cv2.circle(img, (c, c), int(R * 0.24), (110, 110, 115), max(2, int(R * 0.008)), cv2.LINE_AA)
    for b in range(6):
        a = b * np.pi / 3
        cv2.circle(img, (int(c + R * 0.185 * math.cos(a)), int(c + R * 0.185 * math.sin(a))), int(R * 0.02), (70, 70, 74), -1, cv2.LINE_AA)
    cv2.circle(img, (c, c), int(R * 0.115), (28, 28, 30), -1, cv2.LINE_AA)
    img = cv2.resize(img, (S // k, S // k), interpolation=cv2.INTER_AREA).astype(np.float32)
    a = cv2.resize(alpha, (S // k, S // k), interpolation=cv2.INTER_AREA).astype(np.float32)[..., None] / 255
    return np.concatenate([img * a, a], axis=2)


def make_background(w: int, h: int, rng: np.random.Generator, floor_y: float, keep_out: tuple[float, float, float, float]) -> np.ndarray:
    """A cluttered gym wall and floor. `keep_out` (x0, y0, x1, y1) is where the plate travels: no distractor plates there."""
    top = np.array(rng.uniform(90, 200, 3))
    bottom = top * rng.uniform(0.6, 0.9)
    ramp = np.linspace(0, 1, h)[:, None, None]
    img = (top * (1 - ramp) + bottom * ramp).repeat(w, axis=1).astype(np.float32)
    fy = int(np.clip(floor_y, h * 0.5, h - 10))
    img[fy:] = rng.uniform(25, 70, 3)
    for i in range(12):  # floor mats
        x = int(rng.uniform(-w, 2 * w))
        cv2.line(img, (x, fy), (int(w / 2 + (x - w / 2) * 3), h), tuple(float(x) for x in rng.uniform(15, 50, 3)), 2)
    img = img.astype(np.uint8)
    # Posters, a mirror, shelves.
    for _ in range(int(rng.integers(4, 8))):
        x0, y0 = int(rng.uniform(0, w)), int(rng.uniform(0, fy * 0.8))
        ww, hh = int(rng.uniform(0.1, 0.35) * w), int(rng.uniform(0.05, 0.2) * h)
        col = tuple(int(x) for x in rng.uniform(30, 240, 3))
        cv2.rectangle(img, (x0, y0), (x0 + ww, y0 + hh), col, -1)
        for _ in range(3):
            cv2.rectangle(img, (x0 + int(rng.uniform(0, ww)), y0 + int(rng.uniform(0, hh))), (x0 + int(rng.uniform(0, ww)), y0 + int(rng.uniform(0, hh))), tuple(int(x) for x in rng.uniform(0, 255, 3)), -1)
        cv2.putText(img, rng.choice(['GYM', 'PUSH', 'NO PAIN', 'SQUAT', 'TEAM']), (x0 + 5, y0 + hh // 2), cv2.FONT_HERSHEY_SIMPLEX, ww / 220, (20, 20, 20), 2, cv2.LINE_AA)
    # Rack uprights behind the lifter, with their rows of holes.
    for _ in range(2):
        x = int(rng.uniform(0.1, 0.9) * w)
        uw = int(rng.uniform(0.025, 0.045) * w)
        col = tuple(int(x) for x in rng.choice([[25, 25, 25], [30, 30, 150], [60, 60, 60], [20, 90, 20]]))
        cv2.rectangle(img, (x, int(h * 0.05)), (x + uw, fy), col, -1)
        for yy in range(int(h * 0.08), fy, max(8, uw)):
            cv2.circle(img, (x + uw // 2, yy), max(2, uw // 5), (200, 200, 200), -1)
    # Clutter: dumbbells and boxes along the floor.
    for _ in range(int(rng.integers(30, 70))):
        x0, y0 = int(rng.uniform(0, w)), int(rng.uniform(fy - 0.25 * h, fy + 0.05 * h))
        cv2.rectangle(img, (x0, y0), (x0 + int(rng.uniform(5, 50)), y0 + int(rng.uniform(5, 40))), tuple(int(x) for x in rng.uniform(10, 230, 3)), -1)
    # Other plates on a tree: round, rimmed, the obvious thing to mistake for the bar's plate.
    kx0, ky0, kx1, ky1 = keep_out
    placed = 0
    for _ in range(80):
        if placed >= rng.integers(3, 7):
            break
        r = int(rng.uniform(0.3, 0.55) * (kx1 - kx0) / 2.6)
        x, y = int(rng.uniform(r, w - r)), int(rng.uniform(h * 0.35, fy))
        if x + r > kx0 and x - r < kx1 and y + r > ky0 and y - r < ky1:
            continue
        col = tuple(int(x) for x in rng.choice([[30, 30, 32], [150, 80, 25], [40, 40, 170], [60, 130, 40], [40, 180, 200]]))
        cv2.circle(img, (x, y), r, col, -1, cv2.LINE_AA)
        cv2.circle(img, (x, y), int(r * 0.92), tuple(min(255, c + 30) for c in col), 2, cv2.LINE_AA)
        cv2.circle(img, (x, y), int(r * 0.22), (170, 170, 175), -1, cv2.LINE_AA)
        placed += 1
    img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.8, 1.6))  # the wall is out of focus
    # Vignette.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    vig = 1 - 0.25 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2) * 2
    return np.clip(img * vig[..., None], 0, 255).astype(np.uint8)


def _capsule_alpha(xx: np.ndarray, yy: np.ndarray, a: np.ndarray, b: np.ndarray, r: float) -> np.ndarray:
    """Coverage (0–1, 1 px soft edge) of the capsule of radius r around segment a–b, on the pixel grid xx, yy."""
    d = b - a
    L2 = float(d @ d)
    u = np.clip(((xx - a[0]) * d[0] + (yy - a[1]) * d[1]) / L2, 0, 1) if L2 > 0 else np.zeros_like(xx)
    dist = np.hypot(xx - (a[0] + u * d[0]), yy - (a[1] + u * d[1]))
    return np.clip(r + 0.5 - dist, 0, 1)


class Scene:
    def __init__(self, spec: Spec, motion: dict):
        self.spec = spec
        rng = np.random.default_rng(spec.seed + 7919)
        self.rng = rng
        w, h = spec.width, spec.height
        cam_h = rng.uniform(0.85, 1.2)
        self.cam = Camera(w, h, rng.uniform(58, 66), spec.pitch, spec.roll, np.array([0.0, cam_h, 0.0]))
        th = math.radians(spec.yaw)
        self.n = np.array([math.sin(th), 0, math.cos(th)])  # bar axis, away from the camera
        self.eu = np.array([math.cos(th), 0, -math.sin(th)])  # forward, in the plate's plane
        self.ev = np.array([0.0, 1.0, 0.0])
        self.x0 = rng.uniform(-0.2, 0.2) * spec.distance * w / h
        self.motion = motion
        self.sprite = make_plate_sprite(rng)
        S = self.sprite.shape[0]
        cs = S / 2
        m = (PLATE_D / 2) / SPRITE_R
        self.sprite_to_plane = np.diag([m, m, 1.0]) @ np.array([[1, 0, -cs], [0, -1, cs], [0, 0, 1.0]])
        self.sprite_centre = np.array([cs, cs, 1.0])
        # Clothing and the arm that passes in front of the plate.
        self.shirt = tuple(float(x) for x in rng.uniform(20, 220, 3))
        self.shorts = tuple(float(x) for x in rng.uniform(10, 120, 3))
        self.skin = tuple(float(x) for x in np.array([110, 140, 190]) * rng.uniform(0.55, 1.1))
        self.occ_dir = rng.uniform(0, 2 * np.pi)
        self.occ_period = rng.uniform(2.2, 4.0)
        self.occ_phase = rng.uniform(0, 2 * np.pi)
        # Shake: a few slow sinusoids in x, y and rotation.
        self.shake = [(rng.uniform(0.4, 3.0), rng.uniform(0, 6), rng.uniform(0.3, 1.0)) for _ in range(3)]
        self.light = (rng.uniform(4, 7), rng.uniform(0, 6), rng.uniform(1.2, 2.2), rng.uniform(0, 6))

        top = self.centre(0, motion['y_top'])
        bot = self.centre(0, motion['y_top'] - spec.rom)
        pt, pb = self.cam.project(top), self.cam.project(bot)
        rpx = self.cam.f * PLATE_D / 2 / spec.distance
        if min(pt[1], pb[1]) - rpx < 0.03 * h or max(pt[1], pb[1]) + rpx > 0.97 * h or abs(pt[0] - w / 2) + rpx > 0.48 * w:
            raise RuntimeError(f'{spec.name}: plate leaves the frame; change camera height or distance')
        floor_y = self.cam.project(np.array([self.x0, 0.0, spec.distance + 1.2]))[1]
        keep = (min(pt[0], pb[0]) - 2 * rpx, min(pt[1], pb[1]) - 2 * rpx, max(pt[0], pb[0]) + 2 * rpx, max(pt[1], pb[1]) + 2 * rpx)
        self.bg = make_background(w, h, rng, floor_y, keep)
        self.noise = []
        for _ in range(6):
            nz = rng.normal(0, spec.noise, (h, w, 1)) + rng.normal(0, spec.noise * 0.4, (h, w, 3))
            self.noise.append((np.clip(nz, 0, 255).astype(np.uint8), np.clip(-nz, 0, 255).astype(np.uint8)))

    def centre(self, sway: float, y: float) -> np.ndarray:
        return np.array([self.x0, y, self.spec.distance]) + sway * self.eu

    def at(self, t: float) -> dict:
        m = self.motion
        y = float(np.interp(t, m['t'], m['h']))
        sway = float(np.interp(t, m['t'], m['sway']))
        rot = math.radians(float(np.interp(t, m['t'], m['rot'])))
        return {'y': y, 'C': self.centre(sway, y), 'rot': rot, 'depth': (m['y_top'] - y) / self.spec.rom}

    def homography(self, st: dict) -> np.ndarray:
        """Sprite pixels → image pixels for the plate in state `st`."""
        c, s = math.cos(st['rot']), math.sin(st['rot'])
        rot = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])
        B = np.column_stack([self.eu, self.ev, st['C'] - self.cam.pos])
        return self.cam.K @ self.cam.R @ B @ rot @ self.sprite_to_plane

    def shake_matrix(self, t: float) -> np.ndarray:
        a = self.spec.shake
        sx = sum(a * amp * math.sin(2 * np.pi * f * t + ph) for f, ph, amp in self.shake) / 1.5
        sy = sum(a * amp * math.cos(2 * np.pi * f * 1.3 * t + ph) for f, ph, amp in self.shake) / 1.5
        ang = 0.02 * a * math.sin(2 * np.pi * self.shake[0][0] * 0.7 * t)
        M = cv2.getRotationMatrix2D((self.spec.width / 2, self.spec.height / 2), ang, 1.0)
        M[:, 2] += (sx, sy)
        return np.vstack([M, [0, 0, 1]])

    def occlusion_at(self, t: float) -> float:
        return self.spec.occlusion * 0.5 * (1 - math.cos(2 * np.pi * t / self.occ_period + self.occ_phase))

    def draw_body(self, img: np.ndarray, st: dict) -> None:
        """The lifter, in the bar's sagittal plane at mid-bar (behind the plate), from the plate's height and depth."""
        Cb = st['C'] + 0.8 * self.n
        d = st['depth']
        y = st['y']
        pts = {
            'ankle': (-0.05, 0.08),
            'knee': (0.12 + 0.22 * d, 0.5 - 0.06 * d),
            'hip': (-0.1 - 0.3 * d, y - 0.52 + 0.14 * d),
            'shoulder': (-0.03, y - 0.02),
            'head': (0.06 + 0.06 * d, y + 0.2 - 0.04 * d),
            'elbow': (-0.16, y - 0.22),
            'hand': (0.0, y + 0.01),
        }
        # Sagittal offset from the bar and height above the floor, m.
        P = {k: Cb + s * self.eu + np.array([0, yy - Cb[1], 0]) for k, (s, yy) in pts.items()}
        img_pts = {k: self.cam.project(p) for k, p in P.items()}
        px_m = lambda p: self.cam.f / self.cam.depth(p)  # noqa: E731

        def limb(a, b, width, col):
            pa, pb = img_pts[a], img_pts[b]
            th = max(1, int(round(width * px_m(P[a]))))
            cv2.line(img, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), col, th, cv2.LINE_AA)

        limb('ankle', 'knee', 0.12, self.shorts)
        limb('knee', 'hip', 0.18, self.shorts)
        limb('hip', 'shoulder', 0.3, self.shirt)
        limb('shoulder', 'elbow', 0.09, self.shirt)
        limb('elbow', 'hand', 0.08, self.skin)
        ph = img_pts['head']
        cv2.circle(img, (int(ph[0]), int(ph[1])), max(2, int(0.11 * px_m(P['head']))), self.skin, -1, cv2.LINE_AA)

    def moving_layer(self, base: np.ndarray, t: float, exposure: float) -> None:
        """Plate, sleeve and occluding arm composited over `base` in place, averaged over the exposure (motion blur)."""
        spec = self.spec
        h, w = base.shape[:2]
        st = self.at(t)
        rpx = self.cam.f * PLATE_D / 2 / self.cam.depth(st['C'])
        # Sub-samples: about one per pixel the plate moves during the exposure.
        v = abs(float(np.interp(t, self.motion['t'], self.motion['v'])))
        moved = v * exposure * self.cam.f / self.cam.depth(st['C'])
        k = int(np.clip(math.ceil(moved / 0.8), 1, 12))
        times = [t] if k == 1 else list(t + exposure * (np.arange(k) / (k - 1) - 0.5))
        states = [self.at(tt) for tt in times]
        rim = np.array([[math.cos(a), math.sin(a), 0] for a in np.linspace(0, 2 * np.pi, 24, endpoint=False)])
        corners = []
        for s in states:
            P = s['C'] + PLATE_D / 2 * (rim[:, :1] * self.eu + rim[:, 1:2] * self.ev)
            corners.append(self.cam.project(P))
        corners = np.vstack(corners)
        reach = 2.0 * rpx if spec.occlusion > 0 else 0
        x0 = int(max(0, corners[:, 0].min() - 6 - reach))
        y0 = int(max(0, corners[:, 1].min() - 6 - reach))
        x1 = int(min(w, corners[:, 0].max() + 7 + reach))
        y1 = int(min(h, corners[:, 1].max() + 7 + reach))
        if x1 <= x0 or y1 <= y0:
            return
        roi = base[y0:y1, x0:x1].astype(np.float32)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        acc = np.zeros_like(roi)
        T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1.0]])
        for tt, s in zip(times, states):
            H = T @ self.homography(s)
            warped = cv2.warpPerspective(self.sprite, H, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            frame = roi * (1 - warped[..., 3:4]) + warped[..., :3]
            # The bar sleeve sticks out of the hub towards the camera.
            c_img = self.cam.project(s['C'])
            tip = s['C'] - 0.07 * self.n
            t_img = self.cam.project(tip)
            r_sl = 0.026 * self.cam.f / self.cam.depth(tip)
            al = _capsule_alpha(xx, yy, c_img, t_img, r_sl)[..., None]
            frame = frame * (1 - al) + np.array([150, 150, 155], np.float32) * al
            al = _capsule_alpha(xx, yy, t_img, t_img, r_sl * 0.95)[..., None]
            frame = frame * (1 - al) + np.array([200, 200, 205], np.float32) * al
            occ = self.occlusion_at(tt)
            if occ > 0.005:
                r_now = self.cam.f * PLATE_D / 2 / self.cam.depth(s['C'])
                d = np.array([math.cos(self.occ_dir), math.sin(self.occ_dir)])
                tip_o = c_img + d * r_now * (1 - occ)
                root = c_img + d * r_now * 2.0
                al = np.maximum(_capsule_alpha(xx, yy, root, tip_o, 0.16 * r_now), _capsule_alpha(xx, yy, tip_o, tip_o, 0.22 * r_now))[..., None]
                frame = frame * (1 - al) + np.array(self.skin, np.float32) * al
            acc += frame
        base[y0:y1, x0:x1] = np.clip(acc / len(times) + 0.5, 0, 255).astype(np.uint8)

    def render(self, t: float, exposure: float, index: int) -> tuple[np.ndarray, dict]:
        spec = self.spec
        st = self.at(t)
        img = self.bg.copy()
        self.draw_body(img, st)
        self.moving_layer(img, t, exposure)
        S = self.shake_matrix(t)
        if spec.shake > 0:
            img = cv2.warpAffine(img, S[:2], (spec.width, spec.height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        p1, ph1, p2, ph2 = self.light
        gain = 1 + spec.light * (0.7 * math.sin(2 * np.pi * t / p1 + ph1) + 0.3 * math.sin(2 * np.pi * t / p2 + ph2))
        img = cv2.convertScaleAbs(img, alpha=gain)
        pos, neg = self.noise[index % len(self.noise)]
        img = cv2.subtract(cv2.add(img, pos), neg)
        H = S @ self.homography(st)
        c = H @ self.sprite_centre
        c = c[:2] / c[2]
        top = S @ np.append(self.cam.project(st['C'] + PLATE_D / 2 * self.ev), 1)
        bot = S @ np.append(self.cam.project(st['C'] - PLATE_D / 2 * self.ev), 1)
        return img, {'x': float(c[0]), 'y': float(c[1]), 'd_px': float(np.hypot(*(top[:2] - bot[:2]))), 'occl': self.occlusion_at(t)}

    def ellipse0(self) -> dict:
        """The plate's outline in the first frame: centre, axes and angle as cv2.fitEllipse gives them."""
        st = self.at(0.0)
        S = self.shake_matrix(0.0)
        a = np.linspace(0, 2 * np.pi, 180, endpoint=False)
        P = st['C'] + PLATE_D / 2 * (np.cos(a)[:, None] * self.eu + np.sin(a)[:, None] * self.ev)
        img = self.cam.project(P)
        img = (np.column_stack([img, np.ones(len(img))]) @ S.T)[:, :2]
        (cx, cy), (d1, d2), ang = cv2.fitEllipse(img.astype(np.float32))
        return {'cx': cx, 'cy': cy, 'major_px': max(d1, d2), 'minor_px': min(d1, d2), 'angle': ang}


# ---------------------------------------------------------------------------------------------------------------
# Rendering one video
# ---------------------------------------------------------------------------------------------------------------


def probe_pts(path: str) -> np.ndarray:
    """Presentation timestamps (s) of every video frame, as the decoder reports them."""
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'json', path],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    frames = json.loads(out)['frames']
    return np.array([float(f.get('pts_time', f.get('best_effort_timestamp_time'))) for f in frames])


def render(spec: Spec, out_dir: str, preview: bool = False) -> dict:
    began = time.time()
    motion = build_motion(spec)
    scene = Scene(spec, motion)
    rng = np.random.default_rng(spec.seed + 104729)
    real, pts, expr = frame_times(spec, motion['duration'], rng)
    exposure = min(spec.shutter / spec.fps, 1 / 60)
    video = os.path.join(out_dir, spec.name + '.mp4')
    if preview:
        for i in np.linspace(0, len(real) - 1, 4).astype(int):
            img, g = scene.render(float(real[i]), exposure, int(i))
            cv2.circle(img, (int(g['x']), int(g['y'])), 4, (0, 255, 0), -1)
            cv2.imwrite(os.path.join(out_dir, f'{spec.name}_{i}.png'), img)
        return {}
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{spec.width}x{spec.height}', '-r', str(spec.file_fps), '-i', '-']
    if expr:
        cmd += ['-vf', f"settb=1/{VFR_TB},setpts='({expr})/TB'", '-fps_mode', 'passthrough', '-enc_time_base', f'1/{VFR_TB}', '-video_track_timescale', str(VFR_TB)]
    cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', str(spec.crf), '-pix_fmt', 'yuv420p', '-g', str(spec.file_fps), '-movflags', '+faststart', video]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    frames = []
    for i, t in enumerate(real):
        img, g = scene.render(float(t), exposure, i)
        proc.stdin.write(img.tobytes())
        g.update(pts=float(pts[i]), t=float(t), h=float(np.interp(t, motion['t'], motion['h']) - motion['y_top']), v=float(np.interp(t, motion['t'], motion['v'])))
        frames.append(g)
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError(f'{spec.name}: ffmpeg failed')
    probed = probe_pts(video)
    if len(probed) != len(frames) or np.max(np.abs(probed - pts)) > 2e-4:
        raise RuntimeError(f'{spec.name}: the file has {len(probed)} frames / timestamps off by {np.max(np.abs(probed[: len(pts)] - pts[: len(probed)])):.4f} s')
    for f, p in zip(frames, probed):
        f['pts'] = float(p)
    dts = np.diff(probed)
    reps = [
        {**{k: r[k] for k in ('start', 'end', 'prop_end', 'mcv', 'mpv', 'pv')}, 'rom': r['rom'], 'zone': kinematics.zone_of(r['mcv'])}
        for r in motion['reps']
    ]
    truth = {
        'version': 1,
        'name': spec.name,
        'video': spec.name + '.mp4',
        'spec': dataclasses.asdict(spec),
        'width': spec.width,
        'height': spec.height,
        'fps_capture': spec.fps,
        'fps_file': spec.file_fps,
        # What a player reports as the frame rate: frames over duration, rounded.
        'fps_reported': int(round((len(probed) - 1) / (probed[-1] - probed[0]))),
        'time_scale': spec.time_scale,
        'vfr': spec.vfr,
        'frame_interval': {'min': float(dts.min()), 'max': float(dts.max()), 'median': float(np.median(dts))},
        'plate': {'diameter_m': PLATE_D, **scene.ellipse0(), 'vertical_px': frames[0]['d_px'], 'x0': frames[0]['x'], 'y0': frames[0]['y']},
        'exposure_s': exposure,
        'frames': {k: [round(f[k], 6) for f in frames] for k in ('pts', 't', 'x', 'y', 'h', 'v', 'd_px', 'occl')},
        'reps': reps,
        'render_s': round(time.time() - began, 1),
    }
    with open(os.path.join(out_dir, spec.name + '.json'), 'w') as fh:
        json.dump(truth, fh)
    return truth


# ---------------------------------------------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------------------------------------------


def _fatigue(v0: float, n: int, rng: np.random.Generator) -> list[float]:
    """MCV of each rep of a set: each rep a few per cent slower than the one before."""
    out = [v0]
    for _ in range(n - 1):
        out.append(out[-1] * (1 - rng.uniform(0.02, 0.06)))
    return [round(v, 3) for v in out]


def quick_dataset() -> list[Spec]:
    """Eight sets that touch every zone and every condition once, plus two retest twins: a few minutes end to end."""
    specs = [
        Spec('q01', 101, 'bounce', [1.05, 1.0, 0.95], fps=60, yaw=4, pitch=2),
        Spec('q02', 102, 'grinder', [0.21], fps=60, yaw=10, pitch=-2, occlusion=0.0),
        Spec('q03', 103, 'paused', [0.64, 0.6], fps=30, vfr=True, yaw=14, pitch=4),
        Spec('q04', 104, 'tng', [0.86, 0.82, 0.78], fps=120, yaw=3, occlusion=0.45, rom=0.5),
        Spec('q05', 105, 'bounce', [1.55, 1.5, 1.42], fps=240, yaw=0, shutter=0.8, rom=0.5),
        Spec('q06', 106, 'bounce', [0.46, 0.43, 0.4], fps=60, vfr=True, width=1080, height=1920, yaw=22, pitch=-5),
        Spec('q07', 107, 'bounce', [1.22, 1.16], fps=240, slowmo=True, yaw=6, pitch=1),
        Spec('q08', 108, 'paused', [0.33, 0.31], fps=30, width=1080, height=1920, noise=6, crf=30, shake=3, light=0.12),
    ]
    twins = []
    for s in (specs[0], specs[5]):
        twins.append(_twin(s, s.seed + 1000))
    return specs + twins


def _twin(s: Spec, seed: int) -> Spec:
    """The same set filmed again: same motion, the camera a little moved, new noise, shake, light and occlusion."""
    rng = np.random.default_rng(seed)
    return dataclasses.replace(
        s,
        name=s.name + 'r',
        seed=seed,
        motion_seed=s.motion_seed if s.motion_seed is not None else s.seed,
        retest_of=s.name,
        yaw=float(np.clip(s.yaw + rng.uniform(-2, 2), 0, 25)),
        pitch=s.pitch + rng.uniform(-1, 1),
        distance=s.distance * rng.uniform(0.95, 1.05),
        noise=float(np.clip(s.noise + rng.uniform(-1, 1), 1, 7)),
        crf=int(np.clip(s.crf + rng.integers(-2, 3), 18, 30)),
        shake=float(np.clip(s.shake + rng.uniform(-0.5, 0.5), 0, 3)),
    )


def full_dataset(n: int = 40, twins: int = 10, seed: int = 7) -> list[Spec]:
    """
    `n` sets stratified over the five velocity zones (first-rep MCV 0.15–1.6 m/s), with styles, frame rates and
    nuisance conditions spread so every level of every condition gets several sets; plus `twins` retest pairs.
    """
    rng = np.random.default_rng(seed)
    zones = [(0.15, 0.5), (0.5, 0.75), (0.75, 1.0), (1.0, 1.3), (1.3, 1.62)]
    fps_cycle = [60, 30, 120, 60, 240, 30, 60, 120]
    specs = []
    for i in range(n):
        lo, hi = zones[i % 5]
        v0 = float(rng.uniform(lo, hi))
        if v0 < 0.35:
            style = rng.choice(['grinder', 'paused', 'bounce'], p=[0.5, 0.3, 0.2])
        elif v0 > 1.2:
            style = 'bounce'
        else:
            style = rng.choice(['bounce', 'paused', 'tng'], p=[0.5, 0.25, 0.25])
        reps = int(rng.integers(1, 3)) if v0 < 0.5 else int(rng.integers(2, 5))
        fps = fps_cycle[i % len(fps_cycle)]
        slowmo = fps == 240 and i % 3 == 0
        if slowmo:
            reps = min(reps, 2)
        if fps == 240 and not slowmo:
            reps = min(reps, 3)
        vfr = fps in (30, 60) and i % 4 == 1
        big = rng.random() < 0.3 and fps <= 120
        occ = float(rng.choice([0.0, 0.0, 0.0, 0.25, 0.5]))
        specs.append(
            Spec(
                f'f{i + 1:02d}',
                1000 + i,
                str(style),
                _fatigue(v0, reps, rng),
                rom=float(rng.uniform(0.45, 0.62)),
                fps=fps,
                vfr=vfr,
                slowmo=slowmo,
                width=1080 if big else 720,
                height=1920 if big else 1280,
                yaw=float(rng.uniform(0, 25)),
                pitch=float(rng.uniform(-6, 6)),
                roll=float(rng.uniform(-1, 1)),
                distance=float(rng.uniform(2.4, 3.6)),
                occlusion=occ,
                noise=float(rng.uniform(1.5, 6)),
                crf=int(rng.integers(18, 31)),
                shake=float(rng.uniform(0, 3)),
                light=float(rng.uniform(0, 0.12)),
                shutter=float(rng.uniform(0.3, 1.0)),
            )
        )
    picks = rng.choice(len(specs), size=min(twins, len(specs)), replace=False)
    return specs + [_twin(specs[int(k)], 5000 + int(k)) for k in sorted(picks)]


def dataset(size: str) -> list[Spec]:
    if size == 'quick':
        return quick_dataset()
    if size == 'full':
        return full_dataset()
    n = int(size)
    return full_dataset(n=n, twins=max(1, n // 4))


def _render_job(args: tuple[Spec, str]) -> tuple[str, float, str | None]:
    spec, out = args
    began = time.time()
    try:
        render(spec, out)
        return spec.name, time.time() - began, None
    except Exception as e:  # noqa: BLE001 — reported, not hidden
        return spec.name, time.time() - began, f'{type(e).__name__}: {e}'


def render_dataset(specs: list[Spec], out: str, jobs: int = 4, force: bool = False, log=print) -> list[str]:
    """Renders every spec not already in `out`; returns the names that failed."""
    os.makedirs(out, exist_ok=True)
    todo = [s for s in specs if force or not (os.path.exists(os.path.join(out, s.name + '.json')) and os.path.exists(os.path.join(out, s.name + '.mp4')))]
    failed = []
    # Longest first, so the pool doesn't end on one long video.
    todo.sort(key=lambda s: -(s.fps * len(s.mcv) * s.width))
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        for name, secs, err in pool.map(_render_job, [(s, out) for s in todo]):
            log(f'  rendered {name} in {secs:.0f} s' + (f'  FAILED {err}' if err else ''))
            if err:
                failed.append(name)
    with open(os.path.join(out, 'dataset.json'), 'w') as fh:
        json.dump([dataclasses.asdict(s) for s in specs], fh, indent=1)
    return failed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', default='quick', help='quick, full or a number of sets')
    ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument('--only', help='render just this video of the dataset')
    ap.add_argument('--preview', action='store_true', help='with --only: write PNGs of four frames instead')
    ap.add_argument('--force', action='store_true', help='re-render videos that already exist')
    a = ap.parse_args()
    specs = dataset(a.size)
    os.makedirs(a.out, exist_ok=True)
    if a.only:
        spec = next(s for s in specs if s.name == a.only)
        render(spec, a.out, preview=a.preview)
        return
    failed = render_dataset(specs, a.out, a.jobs, a.force)
    if failed:
        sys.exit(f'failed: {", ".join(failed)}')


if __name__ == '__main__':
    main()
