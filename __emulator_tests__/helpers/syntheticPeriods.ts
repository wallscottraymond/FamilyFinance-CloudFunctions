/**
 * syntheticPeriods — weekly (Sun–Sat) and twice-a-month source periods visible ONLY to this test
 * file's process (the derive's `source_period_repo.get_overlapping` is wrapped while `fn` runs).
 * The emulator is shared: seeding real weekly periods in a year other suites use would change
 * what their period creators make.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { Timestamp } from 'firebase-admin/firestore';

const DAY = 86400000;
export interface SyntheticPeriod { id: string; period_id: string; period_type: string; start_date: Timestamp; end_date: Timestamp; year: number; index: number }

/** Weeks from `first_sunday_ms` until `until_ms`, and halves for the months of [from_ms, until_ms). */
export function synthetic(first_sunday_ms: number, until_ms: number, prefix = 'SYN'): SyntheticPeriod[] {
  const out: SyntheticPeriod[] = [];
  const add = (id: string, type: string, start: number, end: number) => out.push({
    id, period_id: id, period_type: type, start_date: Timestamp.fromMillis(start), end_date: Timestamp.fromMillis(end),
    year: new Date(start).getUTCFullYear(), index: 0,
  });
  for (let s = first_sunday_ms, n = 0; s < until_ms; s += 7 * DAY, n++) add(`${prefix}W${String(n).padStart(3, '0')}`, 'weekly', s, s + 7 * DAY - 1);
  const d = new Date(first_sunday_ms);
  for (let y = d.getUTCFullYear(), m = d.getUTCMonth(); Date.UTC(y, m, 1) < until_ms; m++) {
    const key = `${new Date(Date.UTC(y, m, 1)).getUTCFullYear()}_${new Date(Date.UTC(y, m, 1)).getUTCMonth() + 1}`;
    add(`${prefix}BM${key}A`, 'bi_monthly', Date.UTC(y, m, 1), Date.UTC(y, m, 16) - 1);
    add(`${prefix}BM${key}B`, 'bi_monthly', Date.UTC(y, m, 16), Date.UTC(y, m + 1, 1) - 1);
  }
  return out;
}

export function period_at(periods: SyntheticPeriod[], type: string, ms: number): SyntheticPeriod {
  return periods.find((p) => p.period_type === type && p.start_date.toMillis() <= ms && p.end_date.toMillis() >= ms)!;
}

export async function withSyntheticPeriods<T>(periods: SyntheticPeriod[], fn: () => Promise<T>): Promise<T> {
  const repo = require('../../src/functions/repositories/source_period.repo').source_period_repo;
  const orig = repo.get_overlapping;
  repo.get_overlapping = async (ctx: unknown, anchor: Timestamp, end: Timestamp) => {
    const real = await orig.call(repo, ctx, anchor, end);
    const lower = anchor.toMillis() - 31 * DAY;
    const extra = periods.filter((p) =>
      p.start_date.toMillis() >= lower && p.start_date.toMillis() <= end.toMillis() && p.end_date.toMillis() >= anchor.toMillis());
    return [...real, ...extra].sort((a: any, b: any) => a.start_date.toMillis() - b.start_date.toMillis());
  };
  try {
    return await fn();
  } finally {
    repo.get_overlapping = orig;
  }
}
