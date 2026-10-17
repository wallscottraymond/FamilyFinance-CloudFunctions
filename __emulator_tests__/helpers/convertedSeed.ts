/**
 * convertedSeed — seeds a converted bill / income exactly as the convert path stores it (built by
 * the same pure builder + the same repo mapper), so emulator suites can test going-forward
 * matching, absorb and merge without the convert callable. Emulator suites only.
 */
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
import { Firestore } from 'firebase-admin/firestore';
import { NOW_MS, ScenarioIds } from './captureScenario';

const DAY = 86400000;

export interface SeedConvertedOpts {
  id: string;
  direction?: 'outflow' | 'inflow';
  name: string;
  amount: number;
  /** The vendor key (lower-cased) payments are matched by. */
  vendor_key: string;
  account: 'chk' | 'sav' | 'card';
  frequency?: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly';
  /** Days before NOW the record was created by the new path (its D1 floor); default 0 = today. */
  converted_days_ago?: number;
  first_days_ago?: number;
  next_days?: number;
  retro_plaid_ids?: string[];
  merchant_source?: string;
  periods?: boolean;
}

export async function seedConverted(db: Firestore, ids: ScenarioIds, o: SeedConvertedOpts): Promise<string> {
  const { build_converted_recurring } = require('../../src/functions/domain/recurring/convert_recurring.service');
  const { outflow_repo } = require('../../src/functions/repositories/outflow.repo');
  const { inflow_repo } = require('../../src/functions/repositories/inflow.repo');
  const direction = o.direction ?? 'outflow';
  const built = build_converted_recurring({
    id: o.id, direction, user_id: ids.userId, name: o.name, amount: o.amount, frequency: o.frequency ?? 'monthly',
    next_due_ms: NOW_MS + (o.next_days ?? 15) * DAY - ((NOW_MS + (o.next_days ?? 15) * DAY) % DAY),
    first_date_ms: NOW_MS - (o.first_days_ago ?? 60) * DAY - ((NOW_MS - (o.first_days_ago ?? 60) * DAY) % DAY),
    account_id: (ids as any)[o.account], vendor_key: o.vendor_key, merchant_source: o.merchant_source ?? o.name,
    converted_from_txn_id: null, now_ms: NOW_MS - (o.converted_days_ago ?? 0) * DAY,
  });
  if (built.errors) throw new Error(built.errors.join('; '));
  const repo = direction === 'outflow' ? outflow_repo : inflow_repo;
  const { ref, data } = repo.build_new_doc(built.outflow ?? built.inflow, 'seed_run');
  delete (data as any).syncRunId;
  delete (data as any).lastWriteSource;
  await ref.set({ ...data, ...(o.retro_plaid_ids ? { retroTxnIds: o.retro_plaid_ids } : {}) });
  if (o.periods) {
    const { generate_periods_inline } = require('../../src/functions/orchestrators/recurring/generate_periods_inline');
    await generate_periods_inline({ trace_id: 'seed', span_id: 's' }, ids.userId, [
      { id: o.id, kind: direction, created: true, before: null, after: (await ref.get()).data() },
    ]);
  }
  return o.id;
}
