import { athleteFileName, ATHLETE_FORMAT, backupFileName, BACKUP_FORMAT, backupHash, describeBackup, isPristine, parseAthleteFile, parseBackup, retargetId, type Backup } from '../backup';

function backup(overrides: Partial<Backup> = {}): Backup {
  return {
    format: BACKUP_FORMAT,
    schema_version: 7,
    exported_at: '2026-10-28T08:00:00.000Z',
    tables: {
      athlete: [{ id: 1, name: '我自己' }],
      test_session: [
        { id: 'a', athlete_id: 1, metric_code: 'cmj', started_at: '2026-10-27T08:00:00Z' },
        { id: 'b', athlete_id: 1, metric_code: 'cmj', started_at: '2026-10-28T08:00:00Z' },
      ],
      trial: [{ id: 1, session_id: 'a', value: 45.2 }],
      plan: [],
      workout: [{ id: 1, plan_id: 1, date: '2026-10-27' }],
      set_log: [],
    },
    ...overrides,
  };
}

describe('parseBackup', () => {
  it('reads back what was written', () => {
    const b = backup();
    expect(parseBackup(JSON.stringify(b), 7)).toEqual({ ok: true, backup: b });
  });

  it('accepts a backup from an older schema, the missing columns take their defaults on restore', () => {
    expect(parseBackup(JSON.stringify(backup({ schema_version: 3 })), 7).ok).toBe(true);
  });

  it('refuses a backup from a newer app, its columns would be dropped', () => {
    expect(parseBackup(JSON.stringify(backup({ schema_version: 8 })), 7)).toEqual({ ok: false, problem: '这份备份来自更新版本的 App，先更新 App 再恢复。' });
  });

  it.each([
    ['not JSON', 'hello'],
    ['another JSON file', JSON.stringify({ name: 'x' })],
    ['JSON that is not an object', '[1, 2]'],
  ])('refuses %s', (_, text) => {
    expect(parseBackup(text, 7)).toEqual({ ok: false, problem: '这不是 Jump Attack 的备份文件。' });
  });

  it('accepts a backup missing a table, e.g. one made before that table was added', () => {
    const b = backup();
    const { set_log: _, ...tables } = b.tables;
    expect(parseBackup(JSON.stringify({ ...b, tables }), 7).ok).toBe(true);
  });

  it('refuses a table that is not a list of rows', () => {
    const b = { ...backup(), tables: { ...backup().tables, trial: 'x' } };
    expect(parseBackup(JSON.stringify(b), 7)).toEqual({ ok: false, problem: '备份文件里的 trial 有损坏的记录。' });
  });

  it('refuses rows holding anything but text, numbers and null', () => {
    const b = backup();
    b.tables.trial = [{ id: 1, session_id: 'a', value: { x: 1 } as unknown as number }];
    expect(parseBackup(JSON.stringify(b), 7)).toEqual({ ok: false, problem: '备份文件里的 trial 有损坏的记录。' });
  });

  it('refuses a backup without anyone to test, the app needs at least one athlete', () => {
    const b = backup();
    b.tables.athlete = [];
    expect(parseBackup(JSON.stringify(b), 7)).toEqual({ ok: false, problem: '备份里没有测试对象。' });
  });
});

describe('describeBackup', () => {
  it('counts what a person recognises: athletes, tests and workouts', () => {
    expect(describeBackup(backup())).toBe('1 个测试对象、2 次测试、1 次训练');
  });

  it('counts a missing table as none', () => {
    const { workout: _, ...tables } = backup().tables;
    expect(describeBackup({ ...backup(), tables })).toBe('1 个测试对象、2 次测试、0 次训练');
  });
});

describe('backupFileName', () => {
  it('dates the file by the local day so several backups sort in order', () => {
    expect(backupFileName(new Date(2026, 9, 28, 23, 30))).toBe('jump-attack-backup-2026-10-28.json');
  });
});

describe('backupHash', () => {
  it('ignores when it was exported and the order of columns, which Postgres jsonb does not keep', () => {
    const a = backup();
    const b = { ...backup(), exported_at: '2027-01-01T00:00:00Z', tables: { ...a.tables, athlete: [{ name: '我自己', id: 1 }] } };
    expect(backupHash(b)).toBe(backupHash(a));
  });

  it('changes with any value', () => {
    const b = backup();
    b.tables.trial = [{ id: 1, session_id: 'a', value: 45.3 }];
    expect(backupHash(b)).not.toBe(backupHash(backup()));
  });

  it('tells an empty table from a missing one only by content, both hold nothing', () => {
    const { set_log: _, ...tables } = backup().tables;
    expect(backupHash({ ...backup(), tables })).toBe(backupHash(backup()));
  });
});

describe('isPristine', () => {
  const fresh = (): Backup => ({ ...backup(), tables: { athlete: [{ id: 1, name: '我自己', body_mass_kg: null, created_at: '2026-10-28T08:00:00Z' }], trial: [] } });

  it('is true for a phone that only has the default athlete, as after a new install', () => {
    expect(isPristine(fresh())).toBe(true);
  });

  it('is false once anything was recorded', () => {
    expect(isPristine(backup())).toBe(false);
  });

  it('is false once the profile was filled in or renamed', () => {
    const b = fresh();
    b.tables.athlete = [{ ...b.tables.athlete[0], body_mass_kg: 78 }];
    expect(isPristine(b)).toBe(false);
    b.tables.athlete = [{ ...b.tables.athlete[0], body_mass_kg: null, name: 'Minglu' }];
    expect(isPristine(b)).toBe(false);
  });
});

describe('one athlete\'s file', () => {
  const file = () => ({ ...backup(), format: ATHLETE_FORMAT });

  it('reads back what was written', () => {
    const f = file();
    expect(parseAthleteFile(JSON.stringify(f), 7)).toEqual({ ok: true, file: f });
  });

  it('is not taken for a whole backup, which would replace everyone else on the phone with one athlete', () => {
    expect(parseBackup(JSON.stringify(file()), 7)).toEqual({ ok: false, problem: '这是单个运动员的数据文件，请在「我的 → 测试对象」里用「导入运动员」。' });
  });

  it('refuses a whole backup, a file from a newer app and a file with more or fewer than one athlete', () => {
    expect(parseAthleteFile(JSON.stringify(backup()), 7)).toEqual({ ok: false, problem: '这是整台手机的备份文件，请用「从备份文件恢复」。' });
    expect(parseAthleteFile(JSON.stringify({ ...file(), schema_version: 8 }), 7).ok).toBe(false);
    expect(parseAthleteFile(JSON.stringify({ ...file(), tables: { ...file().tables, athlete: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } }), 7)).toEqual({ ok: false, problem: '文件里应该正好有一个运动员。' });
    expect(parseAthleteFile('not json', 7).ok).toBe(false);
  });

  it('calls it a data file to import in its own problems, not a backup to restore', () => {
    expect(parseAthleteFile(JSON.stringify({ ...file(), schema_version: 8 }), 7)).toEqual({ ok: false, problem: '这份文件来自更新版本的 App，先更新 App 再导入。' });
    expect(parseAthleteFile(JSON.stringify({ hello: 1 }), 7)).toEqual({ ok: false, problem: '这不是 Jump Attack 的运动员数据文件。' });
    expect(parseAthleteFile(JSON.stringify({ ...file(), tables: { ...file().tables, trial: [{ id: 1, value: [1] }] } }), 7)).toEqual({ ok: false, problem: '文件里的 trial 有损坏的记录。' });
  });

  it('is named after the athlete and the day, without characters a file name cannot hold', () => {
    expect(athleteFileName('小明', new Date(2026, 9, 28, 23, 30))).toBe('jump-attack-小明-2026-10-28.json');
    expect(athleteFileName('A/B: "C"', new Date(2026, 9, 28))).toBe('jump-attack-A_B_ _C_-2026-10-28.json');
  });
});

describe('retargetId', () => {
  const athletes = new Map([[1, 7]]);
  const workouts = new Map([[12, 40]]);

  it('moves the ids that name their athlete or workout along with them on import', () => {
    // db/bodyMass.ts and db/recovery.ts: day-<athlete>-<metric>-<date>; workout/[date].tsx: warmup-<workout>-<lift>.
    expect(retargetId('day-1-body_mass-2026-10-27', athletes, workouts)).toBe('day-7-body_mass-2026-10-27');
    expect(retargetId('warmup-12-back_squat', athletes, workouts)).toBe('warmup-40-back_squat');
  });

  it('leaves random ids and ids of rows that were not moved as they are', () => {
    expect(retargetId('mh1x2c-4k9a7b', athletes, workouts)).toBe('mh1x2c-4k9a7b');
    expect(retargetId('day-2-hrv-2026-10-27', athletes, workouts)).toBe('day-2-hrv-2026-10-27');
  });
});
