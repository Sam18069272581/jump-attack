import { setLang, tr } from '@/i18n';

import { parseHealthImport, parseSleepHours, SAMPLE_IMPORT } from '../healthImport';

describe('parseSleepHours', () => {
  it.each([
    ['7.4', 7.4],
    ['7:24', 7.4],
    ['7小时24分钟', 7.4],
    ['7 hr 24 min', 7.4],
    ['7h 24m', 7.4],
    ['7 Std. 24 Min.', 7.4],
    ['26640 Sek.', 7.4],
    ['444 分钟', 7.4],
    ['26640 秒', 7.4],
    ['444', 7.4], // bare minutes
    ['26640', 7.4], // bare seconds
  ])('%s → %f h', (raw, h) => {
    expect(parseSleepHours(raw)).toBeCloseTo(h);
  });

  it('is null without a number', () => {
    expect(parseSleepHours('')).toBeNull();
  });
});

describe('parseHealthImport', () => {
  afterEach(() => setLang('zh'));

  it('reads what the Shortcut copies, units and all', () => {
    expect(parseHealthImport(SAMPLE_IMPORT)).toEqual({ values: { hrv: 58, rhr: 52, sleep: 7.4, resp: 14.5 }, problems: [] });
  });

  it('reads the sample in every language, as the Shortcut copies it on an English or German iPhone', () => {
    for (const lang of ['en', 'de'] as const) {
      setLang(lang);
      expect(parseHealthImport(tr(SAMPLE_IMPORT))).toEqual({ values: { hrv: 58, rhr: 52, sleep: 7.4, resp: 14.5 }, problems: [] });
    }
  });

  it('reads the German names of Apple Health', () => {
    const r = parseHealthImport('Herzfrequenzvariabilität: 61 ms\nRuheherzfrequenz: 49 S/min\nSchlafanalyse: 7 Std. 24 Min.\nAtemfrequenz: 15,2 Atemzüge/min')!;
    expect(r.values).toEqual({ hrv: 61, rhr: 49, sleep: 7.4, resp: 15.2 });
    expect(parseHealthImport('Ruhepuls: 52')!.values).toEqual({ rhr: 52 });
  });

  it('rounds to each metric’s precision and takes a decimal comma', () => {
    const r = parseHealthImport('心率变异性：61.734 毫秒\nResting Heart Rate = 49,6 bpm\n呼吸速率 15,25')!;
    expect(r.values).toEqual({ hrv: 62, rhr: 50, resp: 15.3 });
  });

  it('reads single-line JSON', () => {
    expect(parseHealthImport('{"hrv": 58, "rhr": 52, "sleep": 26640, "resp": 14.5}')!.values).toEqual({ hrv: 58, rhr: 52, sleep: 7.4, resp: 14.5 });
  });

  it('keeps the first value of each and skips lines without a number', () => {
    expect(parseHealthImport('Jump Attack 恢复数据\nHRV: 58\nHRV: 70\n睡眠:\n静息心率: 52')!.values).toEqual({ hrv: 58, rhr: 52 });
  });

  it('drops values that cannot be right', () => {
    const r = parseHealthImport('HRV: 58\n静息心率: 520')!;
    expect(r.values).toEqual({ hrv: 58 });
    expect(r.problems).toEqual([expect.stringContaining('静息心率')]);
  });

  it('is null for unrelated text', () => {
    expect(parseHealthImport('https://example.com 123')).toBeNull();
    expect(parseHealthImport('')).toBeNull();
  });
});
