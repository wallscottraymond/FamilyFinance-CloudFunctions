/**
 * Classify Internal Transfers (orchestrator step)
 *
 * Plaid recurring detection recreates internal account-transfer streams on every
 * sync (they're subscribed) and adds more when new cards are linked. We can't tell
 * an internal transfer from an external ACH bill at transform time — it needs
 * matched-pair detection across accounts. So AFTER each recurring sync we classify
 * the user's recurring outflow/inflow records and durably HIDE the internal ones
 * (kept: external ACH bills + credit-card payments). `isHidden` is preserved by
 * `save_batch`, so the hide survives future re-syncs of the same stream.
 *
 * Self-correcting: also UN-hides transfer records that are no longer internal.
 *
 * @module orchestrators/plaid/classify_internal_transfers
 */

import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";
import { transaction_repo } from "../../repositories/transaction.repo";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
import { is_transfer_category } from "../../domain/transactions/category_semantics.service";
import { detect_internal_transfers_from_txns } from "../../resolvers/shared/on_read_matching";

/** Credit-card payments are always KEPT (a real recurring bill), never hidden. */
const CC_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Window of transactions loaded for matched-pair detection. */
const PAIRING_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export interface ClassifyInternalTransfersResult {
  hidden_outflows: number;
  hidden_inflows: number;
}

/**
 * A recurring record should be HIDDEN when it is a transfer category, is an
 * internal (matched-pair) transfer, and is NOT a credit-card payment.
 */
function should_hide(
  plaid_detailed_category: string,
  transaction_ids: string[] | undefined,
  internal_plaid_ids: Set<string>
): boolean {
  if (plaid_detailed_category === CC_PAYMENT_CATEGORY) return false;
  if (!is_transfer_category(plaid_detailed_category)) return false;
  return (transaction_ids ?? []).some((t) => internal_plaid_ids.has(t));
}

export async function classify_internal_transfers_orchestrator(
  ctx: TraceContext,
  user_id: string,
  now_ms: number
): Promise<ClassifyInternalTransfersResult> {
  // 1. Load recurring records + a recent window of transactions (for pairing).
  const [outflows, inflows, txns] = await Promise.all([
    outflow_repo.get_by_user_id(ctx, user_id),
    inflow_repo.get_by_user_id(ctx, user_id),
    transaction_repo.get_active_in_date_range(ctx, user_id, now_ms - PAIRING_WINDOW_MS, now_ms),
  ]);

  // 2. Matched-pair internal-transfer detection over the window's transfers.
  const { internal_plaid_ids } = detect_internal_transfers_from_txns(txns);

  // 3. Split each collection into hide / unhide (self-correcting).
  const partition = (
    records: Array<{
      id: string;
      plaid_detailed_category: string;
      transaction_ids: string[];
      is_hidden: boolean;
    }>
  ): { hide: string[]; unhide: string[] } => {
    const hide: string[] = [];
    const unhide: string[] = [];
    for (const r of records) {
      const target = should_hide(r.plaid_detailed_category, r.transaction_ids, internal_plaid_ids);
      if (target && !r.is_hidden) hide.push(r.id);
      else if (!target && r.is_hidden) unhide.push(r.id);
    }
    return { hide, unhide };
  };

  const out = partition(outflows);
  const inf = partition(inflows);

  await Promise.all([
    outflow_repo.mark_hidden(ctx, out.hide, true, user_id),
    outflow_repo.mark_hidden(ctx, out.unhide, false, user_id),
    inflow_repo.mark_hidden(ctx, inf.hide, true, user_id),
    inflow_repo.mark_hidden(ctx, inf.unhide, false, user_id),
  ]);

  // Propagate the hidden flag onto the period docs so period-doc readers (e.g. the
  // assign-to-bill picker) exclude internal transfers using the SAME durable signal —
  // not a separate heuristic. Generation already copies `is_hidden`; this keeps the
  // already-materialized periods in sync when classification flips.
  await Promise.all([
    outflow_period_repo.set_hidden_by_outflow_ids(ctx, out.hide, true),
    outflow_period_repo.set_hidden_by_outflow_ids(ctx, out.unhide, false),
    inflow_period_repo.set_hidden_by_inflow_ids(ctx, inf.hide, true),
    inflow_period_repo.set_hidden_by_inflow_ids(ctx, inf.unhide, false),
  ]);

  return { hidden_outflows: out.hide.length, hidden_inflows: inf.hide.length };
}
