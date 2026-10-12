/**
 * Update Transaction Splits (orchestrator) — a split edit from the app, applied IMMEDIATELY
 * (canon O2, Transaction-Integrity-Review 3g) and read-consciously.
 *
 *   1. build the edit in memory (domain/transactions/split_edit: merge onto the stored splits,
 *      the one category edit rule, totals);
 *   2. if the edit touches anything the engine decides on (split set, category, budget / bill
 *      pins), the engine assigns the transaction IN MEMORY (we hold it — no re-read);
 *      a status / amount / note edit skips that (it only moves spend);
 *   3. write ONCE, stamped (`on_transaction_written` skips it), and bump the derive version
 *      RIGHT AFTER the write (so a crash later can't leave the period stale);
 *   4. follow-up: an assignment edit runs the one follow-up pass (reconcile, recompute, transfer
 *      re-check only when a category moved); a spend-only edit enqueues the coalesced recompute
 *      (repeated status taps merge into one).
 * If the in-memory assignment fails the edit is still written, unstamped — the trigger assigns it.
 *
 * @module orchestrators/transactions/update_transaction_splits
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { generate_id } from "../../observability";
import { transaction_repo } from "../../repositories/transaction.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { load_category_catalog } from "../../resolvers/shared/category_catalog.resolver";
import { build_split_edit } from "../../domain/transactions/split_edit.service";
import { create_in_memory_assigner } from "./assign_in_memory";
import { follow_ups_from_written, run_sync_follow_ups } from "../plaid/sync_follow_ups";
import {
  enqueue_recompute_budget_spent,
  enqueue_reconcile_recurring,
} from "../../infrastructure/coalesced_jobs";

export interface UpdateTransactionSplitsInput {
  user_id: string;
  transaction_id: string;
  /** The stored transaction (already read + ownership-checked by the entry). */
  txn: Record<string, unknown>;
  splits: Array<Record<string, unknown>>;
  user_notes?: string;
  is_hidden?: boolean;
  is_recurring?: boolean;
}

export async function update_transaction_splits_orchestrator(
  ctx: TraceContext,
  input: UpdateTransactionSplitsInput
): Promise<Record<string, unknown>> {
  const { txn, transaction_id } = input;
  const owner_id = (txn.userId as string) || input.user_id;
  const now = Timestamp.now();
  const catalog = await load_category_catalog(ctx);

  const edit = build_split_edit(
    input.splits,
    txn,
    catalog,
    input.user_id,
    now,
    (i) => `split_${Date.now()}_${i}`
  );
  /* eslint-disable @typescript-eslint/naming-convention */
  let update: Record<string, unknown> = {
    splits: edit.splits,
    ...edit.totals,
    updatedAt: now,
    updatedBy: input.user_id,
    ...(input.user_notes !== undefined ? { userNotes: input.user_notes } : {}),
    ...(input.is_hidden !== undefined ? { isHidden: input.is_hidden } : {}),
    ...(input.is_recurring !== undefined ? { isRecurring: input.is_recurring } : {}),
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  const txn_date_ms = (txn.transactionDate as Timestamp | undefined)?.toMillis?.();
  let stamped = false;
  if (edit.assignment_relevant && txn_date_ms !== undefined) {
    try {
      const assign = await create_in_memory_assigner(ctx, owner_id, txn_date_ms, txn_date_ms);
      const assigned = await assign(transaction_id, { ...txn, ...update });
      /* eslint-disable @typescript-eslint/naming-convention */
      update = {
        ...update,
        splits: assigned.splits,
        splitBudgetIds: assigned.splitBudgetIds,
        splitOutflowIds: assigned.splitOutflowIds,
        splitInflowIds: assigned.splitInflowIds,
      };
      /* eslint-enable @typescript-eslint/naming-convention */
      stamped = true;
    } catch (error) {
      // Never lose the user's edit: write it unstamped; the trigger re-assigns it.
      console.error(`[${ctx.trace_id}] in-memory assignment failed; the trigger assigns:`, error);
    }
  } else if (!edit.assignment_relevant) {
    stamped = true; // nothing to re-assign; the recompute below covers spend
  }
  if (stamped) {
    update.assignRunId = generate_id();
    update.lastWriteSource = "split_edit";
  }

  await transaction_repo.update_raw(ctx, transaction_id, update);
  // Right after the write: the period page shows the edit even if anything below fails.
  await bump_derive_version(owner_id).catch(() => {});

  const after = { ...txn, ...update };
  if (stamped && edit.assignment_relevant) {
    await run_sync_follow_ups(ctx, owner_id, {
      ...follow_ups_from_written([{ doc_id: transaction_id, before: txn, after }]),
      // A category move can form / break a matched transfer pair; nothing else can.
      transfers_changed: edit.category_changed,
    }).catch((error) => console.error(`[${ctx.trace_id}] split-edit follow-up failed:`, error));
  } else if (stamped && txn_date_ms !== undefined) {
    // Spend only: coalesced recompute (+ reconcile a bill / income a split pays — its paid
    // amount moved); repeated status taps merge into one run.
    const f = follow_ups_from_written([{ doc_id: transaction_id, before: txn, after }]);
    const budget_ids = Object.keys(f.budget_dates);
    if (budget_ids.length) {
      await enqueue_recompute_budget_spent({
        user_id: owner_id,
        budget_ids,
        transaction_date_ms: txn_date_ms,
        trace_id: ctx.trace_id,
      }).catch(() => {});
    }
    for (const [ids, recurring_type] of [
      [f.outflow_ids, "outflow"],
      [f.inflow_ids, "inflow"],
    ] as const) {
      for (const recurring_id of ids) {
        await enqueue_reconcile_recurring({
          user_id: owner_id,
          recurring_id,
          recurring_type,
          trace_id: ctx.trace_id,
        }).catch(() => {});
      }
    }
  }
  return { id: transaction_id, ...after };
}
