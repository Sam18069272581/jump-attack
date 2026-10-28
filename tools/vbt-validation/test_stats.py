"""
Checks stats.py and kinematics.py against published examples and exact cases.
Run: python3 -m pytest test_stats.py   or   python3 test_stats.py
"""
import math

import numpy as np

import kinematics
import stats

# Shrout & Fleiss (1979), Table 2: 6 targets rated by 4 judges.
SHROUT_FLEISS = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
]

# Bland & Altman (1986), Lancet: peak expiratory flow (l/min), first reading on the large Wright meter and on the
# mini Wright meter, 17 subjects. Published: mean difference −2.1, SD 38.8.
WRIGHT = [494, 395, 516, 434, 476, 557, 413, 442, 650, 433, 417, 656, 267, 478, 178, 423, 427]
MINI = [512, 430, 520, 428, 500, 600, 364, 380, 658, 445, 432, 626, 260, 477, 259, 350, 451]


def close(a, b, tol):
    assert abs(a - b) <= tol, f'{a} != {b} (±{tol})'


def test_icc_shrout_fleiss():
    r = stats.icc(SHROUT_FLEISS)
    # Published point estimates: ICC(2,1) = 0.29, ICC(3,1) = 0.71.
    close(r['icc2_1'], 0.29, 0.005)
    close(r['icc3_1'], 0.71, 0.005)
    # Confidence intervals as R's psych::ICC reports them for this table.
    close(r['icc3_1_low'], 0.34, 0.01)
    close(r['icc3_1_high'], 0.95, 0.01)
    close(r['icc2_1_low'], 0.019, 0.01)
    close(r['icc2_1_high'], 0.76, 0.01)
    close(r['F'], 11.03, 0.01)


def test_anova_mean_squares():
    m = stats.anova2(SHROUT_FLEISS)
    # Shrout & Fleiss Table 3: BMS 11.24, JMS 32.49, EMS 1.02, WMS 6.26.
    close(m['msr'], 11.24, 0.01)
    close(m['msc'], 32.49, 0.01)
    close(m['mse'], 1.02, 0.01)
    close(m['msw'], 6.26, 0.01)


def test_bland_altman_pefr():
    r = stats.bland_altman(WRIGHT, MINI)
    close(r['bias'], -2.1, 0.05)
    close(r['sd'], 38.8, 0.05)
    close(r['loa_low'], -2.1 - 1.96 * 38.8, 0.3)
    close(r['loa_high'], -2.1 + 1.96 * 38.8, 0.3)


def test_icc_bias_separates_agreement_from_consistency():
    rng = np.random.default_rng(0)
    truth = rng.uniform(0.2, 1.5, 60)
    shifted = truth + 0.1  # perfectly consistent, but 0.1 m/s high
    r = stats.icc(np.column_stack([shifted, truth]))
    close(r['icc3_1'], 1.0, 1e-9)
    assert r['icc2_1'] < 0.97
    ba = stats.bland_altman(shifted, truth)
    close(ba['bias'], 0.1, 1e-12)
    close(ba['sd'], 0.0, 1e-12)


def test_sem_and_mdc():
    a = np.array([0.50, 0.60, 0.70, 0.80, 0.90])
    b = a + np.array([0.02, -0.02, 0.02, -0.02, 0.0])
    r = stats.sem_mdc(a, b)
    sd = np.std(b - a, ddof=1)
    close(r['sem'], sd / math.sqrt(2), 1e-12)
    close(r['mdc95'], 1.96 * sd, 1e-12)


def test_typical_error_and_see():
    rng = np.random.default_rng(1)
    c = rng.uniform(0.2, 1.5, 2000)
    d = c + rng.normal(0, 0.03, c.size)
    te = stats.typical_error(d, c)
    close(te['te'], 0.03 / math.sqrt(2), 0.002)
    s = stats.see(d, c)
    close(s['see'], 0.03, 0.003)
    close(s['slope'], 1.0, 0.01)


def test_proportional_bias_detected():
    c = np.linspace(0.2, 1.6, 50)
    d = c * 1.05  # 5 % high: the error grows with velocity
    r = stats.bland_altman(d, c)
    assert r['prop_p'] < 1e-6 and r['prop_slope'] > 0
    close(r['bias_pct'], 100 * 0.05 / 1.025, 1e-9)


def test_detection():
    r = stats.detection(9, 1, 3)
    close(r['precision'], 0.9, 1e-12)
    close(r['recall'], 0.75, 1e-12)


def test_phases_half_sine():
    # One rep: rest, rise of 0.5 m with a half-sine velocity over 0.8 s, rest. MCV = 0.625, PV = π/2 · MCV.
    dt = 0.0005
    t = np.arange(0, 2.0, dt)
    T, D, t0 = 0.8, 0.5, 0.5
    tau = np.clip((t - t0) / T, 0, 1)
    v = np.where((t > t0) & (t < t0 + T), D / T * np.pi / 2 * np.sin(np.pi * tau), 0.0)
    h = D * (1 - np.cos(np.pi * tau)) / 2
    reps = kinematics.concentric_phases(t, h, v)
    assert len(reps) == 1
    r = reps[0]
    close(r['mcv'], D / T, 1e-3)
    close(r['pv'], D / T * np.pi / 2, 1e-4)
    close(r['rom'], D, 1e-6)
    # Peak deceleration is (π/2)²·D/T²·… = 3.85 m/s² < g: the whole phase is propulsive.
    close(r['mpv'], r['mcv'], 1e-9)


def test_phases_propulsive_end():
    # Fast rep: half-sine over 0.3 s, 0.45 m. Deceleration exceeds g from t₀ + (π/2 + asin(g / Aω)) / ω.
    dt = 0.0002
    t = np.arange(0, 1.5, dt)
    T, D, t0 = 0.3, 0.45, 0.4
    w = np.pi / T
    A = D / T * np.pi / 2  # peak velocity
    inside = (t > t0) & (t < t0 + T)
    v = np.where(inside, A * np.sin(w * (t - t0)), 0.0)
    h = np.where(t <= t0, 0, np.where(t >= t0 + T, D, D * (1 - np.cos(w * (t - t0))) / 2))
    a = np.where(inside, A * w * np.cos(w * (t - t0)), 0.0)
    r = kinematics.concentric_phases(t, h, v, a)[0]
    t_prop = t0 + (np.pi / 2 + math.asin(kinematics.G / (A * w))) / w
    close(r['prop_end'], t_prop, 1e-3)
    mpv = (D * (1 - math.cos(w * (t_prop - t0))) / 2) / (t_prop - t0)
    close(r['mpv'], mpv, 1e-3)
    assert r['mpv'] > r['mcv']


def test_sticking_point_is_one_rep():
    # The bar rises 20 cm, sinks 2 cm, then rises 37 cm: one rep of 55 cm net.
    dt = 0.001
    seg = lambda dur, dist: (np.linspace(0, 1, int(dur / dt)), dur, dist)  # noqa: E731
    parts = [seg(0.5, 0), seg(1.0, 0.2), seg(0.3, -0.02), seg(1.5, 0.37), seg(0.5, 0)]
    hs, vs, level = [], [], 0.0
    for tau, dur, dist in parts:
        hs.append(level + dist * (1 - np.cos(np.pi * tau)) / 2)
        vs.append(dist / dur * np.pi / 2 * np.sin(np.pi * tau))
        level += dist
    h, v = np.concatenate(hs), np.concatenate(vs)
    t = np.arange(len(h)) * dt
    reps = kinematics.concentric_phases(t, h, v)
    assert len(reps) == 1
    close(reps[0]['rom'], 0.55, 0.002)  # bottom to top; the sag is inside the phase


if __name__ == '__main__':
    tests = [(k, f) for k, f in sorted(globals().items()) if k.startswith('test_') and callable(f)]
    for name, f in tests:
        f()
        print('ok  ', name)
    print(f'{len(tests)} passed')
