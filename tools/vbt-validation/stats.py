"""
Agreement statistics for a measurement against a criterion, and for test–retest pairs.

Conventions (so the numbers in a report can be read without the code):
- difference = device − criterion. Positive bias: the device reads high.
- Bland–Altman: bias = mean difference; 95 % limits of agreement = bias ± 1.96·SD of the differences. The %
  version uses each pair's difference as a share of the pair's mean. Proportional bias: least-squares slope of the
  difference on the pair mean, with its p-value (a slope ≠ 0 means the error grows with velocity).
- ICC from the two-way ANOVA of the n × k table (subjects × methods), Shrout & Fleiss (1979) / McGraw & Wong (1996):
  ICC(2,1) absolute agreement (penalises a constant bias), ICC(3,1) consistency (does not), with 95 % CIs.
- CV % (typical error as a CV, Hopkins): SD of the differences / √2, as a share of the grand mean.
- SEE: residual SD of the least-squares line predicting the criterion from the device (and as % of the criterion
  mean); r of that line.
- Test–retest: SEM = SD of the differences / √2; MDC95 = 1.96 · √2 · SEM, the smallest change between two
  measurements that is bigger than measurement error with 95 % confidence.
- Rep detection: precision = TP / (TP + FP), recall = TP / (TP + FN).
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as st

from kinematics import ZONES


def _arr(x) -> np.ndarray:
    return np.asarray(x, float)


def bland_altman(device, criterion) -> dict:
    d, c = _arr(device), _arr(criterion)
    n = len(d)
    if n < 2:
        return {'n': n}
    diff = d - c
    mean = (d + c) / 2
    sd = float(np.std(diff, ddof=1))
    bias = float(np.mean(diff))
    pct = 100 * diff / np.where(mean == 0, np.nan, mean)
    pbias, psd = float(np.nanmean(pct)), float(np.nanstd(pct, ddof=1))
    out = {
        'n': n,
        'bias': bias,
        'sd': sd,
        'loa_low': bias - 1.96 * sd,
        'loa_high': bias + 1.96 * sd,
        'bias_pct': pbias,
        'loa_pct_low': pbias - 1.96 * psd,
        'loa_pct_high': pbias + 1.96 * psd,
    }
    if n >= 3 and np.ptp(mean) > 0:
        reg = st.linregress(mean, diff)
        out.update(prop_slope=float(reg.slope), prop_intercept=float(reg.intercept), prop_r=float(reg.rvalue), prop_p=float(reg.pvalue))
    return out


def anova2(table) -> dict:
    """Mean squares of the two-way ANOVA without replication on an n (subjects) × k (raters/methods) table."""
    Y = _arr(table)
    n, k = Y.shape
    grand = Y.mean()
    ss_total = ((Y - grand) ** 2).sum()
    ss_rows = k * ((Y.mean(axis=1) - grand) ** 2).sum()
    ss_cols = n * ((Y.mean(axis=0) - grand) ** 2).sum()
    ss_err = ss_total - ss_rows - ss_cols
    return {
        'n': n,
        'k': k,
        'msr': ss_rows / (n - 1),
        'msc': ss_cols / (k - 1),
        'mse': ss_err / ((n - 1) * (k - 1)),
        'msw': (ss_cols + ss_err) / (n * (k - 1)),
    }


def icc(table, alpha: float = 0.05) -> dict:
    """ICC(2,1) and ICC(3,1) with (1 − alpha) confidence intervals, from an n × k table (n ≥ 3, k ≥ 2)."""
    Y = _arr(table)
    n, k = Y.shape
    if n < 3:
        return {'n': n}
    m = anova2(Y)
    msr, msc, mse = m['msr'], m['msc'], m['mse']
    df1, df2 = n - 1, (n - 1) * (k - 1)
    out: dict = {'n': n, 'k': k}
    if mse <= 0:
        # Perfect agreement apart from column offsets.
        out.update(icc3_1=1.0, icc2_1=float(msr / (msr + k * (msc - mse) / n)) if msr > 0 else float('nan'))
        return out
    icc3 = (msr - mse) / (msr + (k - 1) * mse)
    F3 = msr / mse
    fl = F3 / st.f.ppf(1 - alpha / 2, df1, df2)
    fu = F3 * st.f.ppf(1 - alpha / 2, df2, df1)
    out.update(icc3_1=float(icc3), icc3_1_low=float((fl - 1) / (fl + k - 1)), icc3_1_high=float((fu - 1) / (fu + k - 1)), F=float(F3), p=float(st.f.sf(F3, df1, df2)))
    icc2 = (msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n)
    # McGraw & Wong (1996) case 2A, Satterthwaite degrees of freedom for the denominator.
    a = k * icc2 / (n * (1 - icc2))
    b = 1 + k * icc2 * (n - 1) / (n * (1 - icc2))
    v = (a * msc + b * mse) ** 2 / ((a * msc) ** 2 / (k - 1) + (b * mse) ** 2 / df2)
    FL = st.f.ppf(1 - alpha / 2, df1, v)
    FU = st.f.ppf(1 - alpha / 2, v, df1)
    lo = n * (msr - FL * mse) / (FL * (k * msc + (k * n - k - n) * mse) + n * msr)
    hi = n * (FU * msr - mse) / (k * msc + (k * n - k - n) * mse + n * FU * msr)
    out.update(icc2_1=float(icc2), icc2_1_low=float(lo), icc2_1_high=float(hi))
    return out


def typical_error(device, criterion) -> dict:
    d, c = _arr(device), _arr(criterion)
    if len(d) < 2:
        return {}
    te = float(np.std(d - c, ddof=1) / math.sqrt(2))
    grand = float(np.mean(np.concatenate([d, c])))
    return {'te': te, 'cv_pct': 100 * te / grand if grand else float('nan')}


def see(device, criterion) -> dict:
    """Standard error of estimate of the line predicting the criterion from the device."""
    d, c = _arr(device), _arr(criterion)
    n = len(d)
    if n < 3 or np.ptp(d) == 0:
        return {}
    reg = st.linregress(d, c)
    resid = c - (reg.intercept + reg.slope * d)
    s = float(math.sqrt((resid**2).sum() / (n - 2)))
    return {'see': s, 'see_pct': 100 * s / float(np.mean(c)), 'slope': float(reg.slope), 'intercept': float(reg.intercept), 'r': float(reg.rvalue)}


def sem_mdc(test, retest) -> dict:
    """Test–retest reliability of pairs measured twice: SEM, MDC95 (absolute and %), ICCs."""
    a, b = _arr(test), _arr(retest)
    n = len(a)
    if n < 2:
        return {'n': n}
    sem = float(np.std(b - a, ddof=1) / math.sqrt(2))
    mean = float(np.mean(np.concatenate([a, b])))
    out = {'n': n, 'sem': sem, 'sem_pct': 100 * sem / mean, 'mdc95': 1.96 * math.sqrt(2) * sem, 'mdc95_pct': 100 * 1.96 * math.sqrt(2) * sem / mean, 'mean_change': float(np.mean(b - a))}
    if n >= 3:
        out.update({k: v for k, v in icc(np.column_stack([a, b])).items() if k.startswith('icc')})
    return out


def detection(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else float('nan')
    r = tp / (tp + fn) if tp + fn else float('nan')
    f1 = 2 * p * r / (p + r) if p == p and r == r and p + r else float('nan')
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': p, 'recall': r, 'f1': f1}


def agreement(device, criterion) -> dict:
    """Everything above for one device–criterion comparison, plus MAE, RMSE and the worst error."""
    d, c = _arr(device), _arr(criterion)
    out: dict = {'n': len(d)}
    if len(d) == 0:
        return out
    err = d - c
    out.update(mae=float(np.mean(np.abs(err))), rmse=float(np.sqrt(np.mean(err**2))), max_abs=float(np.max(np.abs(err))))
    out.update(mape=float(np.mean(np.abs(err) / np.abs(c)) * 100))
    if len(d) >= 2:
        out.update(bland_altman(d, c))
        out.update(typical_error(d, c))
    if len(d) >= 3:
        out.update(see(d, c))
        out.update({k: v for k, v in icc(np.column_stack([d, c])).items() if k.startswith('icc')})
    return out


def by_zone(criterion, *columns):
    """Splits paired columns by the velocity zone of the criterion: {zone key: (criterion, *columns)}."""
    c = _arr(criterion)
    out = {}
    for key, _, lo, hi in ZONES:
        sel = (c >= lo) & (c < hi)
        out[key] = (c[sel], *[_arr(x)[sel] for x in columns])
    return out
