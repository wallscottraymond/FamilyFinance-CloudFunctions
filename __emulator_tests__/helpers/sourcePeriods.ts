/**
 * sourcePeriods — seed weekly (Sun–Sat) and twice-a-month (1–15 / 16–end) `source_periods` for
 * explicit ranges. Use a year no other suite seeds (the docs are shared): period creators and the
 * derive read every source period in range.
 */
import { Firestore, Timestamp } from 'firebase-admin/firestore';

const DAY = 86400000;

export interface SeededPeriod { id: string; type: 'weekly' | 'bi_monthly' | 'monthly'; start: number; end: number }

/** Week index: W1 = the first Sunday on/after Jan 1 (the app's ids, e.g. 2039W48 = Nov 27 2039). */
function week_id(start_ms: number): string {
  const y = new Date(start_ms).getUTCFullYear();
  const jan1 = Date.UTC(y, 0, 1);
  const first_sunday = jan1 + ((7 - new Date(jan1).getUTCDay()) % 7) * DAY;
  return `${y}W${String(Math.floor((start_ms - first_sunday) / (7 * DAY)) + 1).padStart(2, '0')}`;
}

/** Weeks whose Sunday start is in [from_sunday_ms, to_ms). */
export function weeks(from_sunday_ms: number, to_ms: number): SeededPeriod[] {
  const out: SeededPeriod[] = [];
  for (let s = from_sunday_ms; s < to_ms; s += 7 * DAY) out.push({ id: week_id(s), type: 'weekly', start: s, end: s + 7 * DAY - 1 });
  return out;
}

/** Twice-a-month halves for the months [y, m] given (m 1-based). */
export function halves(months: Array<[number, number]>): SeededPeriod[] {
  return months.flatMap(([y, m]) => [
    { id: `${y}BM${String(m).padStart(2, '0')}A`, type: 'bi_monthly' as const, start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m - 1, 16) - 1 },
    { id: `${y}BM${String(m).padStart(2, '0')}B`, type: 'bi_monthly' as const, start: Date.UTC(y, m - 1, 16), end: Date.UTC(y, m, 1) - 1 },
  ]);
}

export function months(list: Array<[number, number]>): SeededPeriod[] {
  return list.map(([y, m]) => ({
    id: `${y}M${String(m).padStart(2, '0')}`, type: 'monthly' as const, start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) - 1,
  }));
}

export async function seedPeriods(db: Firestore, periods: SeededPeriod[]): Promise<void> {
  const batch = db.batch();
  for (const p of periods) {
    const y = new Date(p.start).getUTCFullYear();
    batch.set(db.collection('source_periods').doc(p.id), {
      id: p.id, periodId: p.id, type: p.type, year: y, index: 0,
      startDate: Timestamp.fromMillis(p.start), endDate: Timestamp.fromMillis(p.end),
    });
  }
  await batch.commit();
}
