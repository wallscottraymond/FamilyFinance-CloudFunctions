/**
 * Recurring Detector Resolver — READ-ONLY lookups for the possible-bill detector.
 *
 * The classifier's scan already holds the window's transactions and the ACTIVE records. The
 * detector also must skip payments in INACTIVE streams (X14), so their stream ids are read here
 * (two small owner-scoped queries, once a day at most). Review items are looked up by their
 * deterministic ids (getAll, X8); account types only when an income candidate needs the gate.
 *
 * @module resolvers/recurring/recurring_detector
 */

import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";
import { account_repo } from "../../repositories/account.repo";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { vendor_key } from "../../domain/transactions/vendor_key.service";
import { ReviewItem, suggested_subject } from "../../domain/recurring/review_item.service";

export interface DetectorContext {
  record_txn_ids: Set<string>;
  record_vendor_subjects: Set<string>;
  load_items: (ids: string[]) => Promise<Map<string, ReviewItem>>;
  load_account_types: () => Promise<Map<string, string>>;
}

export async function resolve_detector_context(
  ctx: TraceContext,
  user_id: string,
  scan: {
    records: Array<{ kind: "outflow" | "inflow"; transaction_ids: string[]; merchant_name: string | null; description: string | null }>;
  }
): Promise<DetectorContext> {
  const [inactive_o, inactive_i] = await Promise.all([
    outflow_repo.get_inactive_by_user_id(ctx, user_id),
    inflow_repo.get_inactive_by_user_id(ctx, user_id),
  ]);
  const record_txn_ids = new Set<string>();
  const record_vendor_subjects = new Set<string>();
  const add = (kind: "outflow" | "inflow", ids: string[], merchant: string | null, description: string | null, active: boolean) => {
    for (const t of ids) record_txn_ids.add(t);
    if (!active) return;
    const v = vendor_key({ merchant_name: merchant, name: description });
    if (v) record_vendor_subjects.add(suggested_subject(kind, v));
  };
  for (const r of scan.records) add(r.kind, r.transaction_ids, r.merchant_name, r.description, true);
  for (const r of inactive_o) add("outflow", r.transaction_ids ?? [], r.merchant_name, r.description, false);
  for (const r of inactive_i) add("inflow", r.transaction_ids ?? [], r.payer_name, r.description, false);
  return {
    record_txn_ids,
    record_vendor_subjects,
    load_items: (ids) => recurring_review_repo.get_items_by_ids(ctx, ids),
    load_account_types: async () => {
      const accounts = await account_repo.get_by_user_id(ctx, user_id);
      const m = new Map<string, string>();
      for (const a of accounts) {
        const type = String(a.account_type ?? "");
        if (a.account_id) m.set(a.account_id, type);
        m.set(a.id, type);
      }
      return m;
    },
  };
}
