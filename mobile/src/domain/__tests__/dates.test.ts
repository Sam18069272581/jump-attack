import { addDays, daysBetween, mondayOf, shortDate, toISODate, weekday } from '../dates';

describe('dates', () => {
  it('formats the local calendar day', () => {
    expect(toISODate(new Date(2026, 9, 19, 23, 30))).toBe('2026-10-19');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7);
    expect(daysBetween('2026-10-26', '2026-10-19')).toBe(-7);
  });

  it('numbers weekdays from Monday', () => {
    expect(weekday('2026-10-19')).toBe(1); // Monday
    expect(weekday('2026-10-25')).toBe(7); // Sunday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
  });

  it('writes short Chinese dates', () => {
    expect(shortDate('2026-10-21')).toBe('10/21 周三');
  });
});
