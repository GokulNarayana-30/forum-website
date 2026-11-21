import { groupSlotsByPeriod, istDayKey, slotDayLabel, slotTimeRange } from './models';

const slot = (starts: string, ends: string, capacity = 3) => ({
  id: starts,
  starts_at: starts,
  ends_at: ends,
  capacity_left: capacity,
  best_for_fasting: false,
});

describe('Slot picker formatting (IST)', () => {
  it('finds the IST day key, also just after midnight IST', () => {
    expect(istDayKey(Date.parse('2026-11-21T10:00:00Z'))).toBe('2026-11-21');
    expect(istDayKey(Date.parse('2026-11-21T19:00:00Z'))).toBe('2026-11-22');
  });

  it('labels days as Today, Tomorrow, then weekday and date', () => {
    expect(slotDayLabel('2026-11-21', '2026-11-21')).toEqual({ title: 'Today', date: '21 Nov' });
    expect(slotDayLabel('2026-11-22', '2026-11-21')).toEqual({ title: 'Tomorrow', date: '22 Nov' });
    expect(slotDayLabel('2026-11-24', '2026-11-21')).toEqual({ title: 'Tue', date: '24 Nov' });
  });

  it('shows a day key that is not a date as it is, instead of failing (preview sample days)', () => {
    expect(slotDayLabel('Example day', '2026-11-21')).toEqual({ title: 'Example day', date: '' });
  });

  it('shows a slot as a short IST time range', () => {
    expect(slotTimeRange(slot('2026-11-22T07:00:00+05:30', '2026-11-22T08:00:00+05:30'))).toBe('7:00 – 8:00 am');
    expect(slotTimeRange(slot('2026-11-22T11:30:00+05:30', '2026-11-22T12:30:00+05:30'))).toBe('11:30 am – 12:30 pm');
  });

  it('groups slots into morning, afternoon and evening by IST start time, keeping order', () => {
    const groups = groupSlotsByPeriod([
      slot('2026-11-22T07:00:00+05:30', '2026-11-22T08:00:00+05:30'),
      slot('2026-11-22T11:00:00+05:30', '2026-11-22T12:00:00+05:30'),
      slot('2026-11-22T13:00:00+05:30', '2026-11-22T14:00:00+05:30'),
      slot('2026-11-22T17:00:00+05:30', '2026-11-22T18:00:00+05:30'),
    ]);
    expect(groups.map((g) => [g.period, g.slots.length])).toEqual([
      ['Morning', 2],
      ['Afternoon', 1],
      ['Evening', 1],
    ]);
  });

  it('leaves out an empty period', () => {
    const groups = groupSlotsByPeriod([slot('2026-11-22T07:00:00+05:30', '2026-11-22T08:00:00+05:30')]);
    expect(groups.map((g) => g.period)).toEqual(['Morning']);
  });
});
