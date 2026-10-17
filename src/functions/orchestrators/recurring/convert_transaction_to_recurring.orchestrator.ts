/**
 * Convert Transaction To Recurring Orchestrator (Convert-To-Recurring Phase 2, D1–D4, D40–D46).
 *
 * "Make this a bill / income": one tap on a transaction (or one split).
 *
 *   flag + purge → resolve (owner first, then facts) → plan (pure: refusals, record, which past
 *   payments link) → ONE Firestore transaction creates the record and pins the source split →
 *   periods generated inline → the chosen past payments assigned in memory by the engine (D1) →
 *   ONE follow-up pass (reconcile the record, recompute only the touched budget periods, one derive
 *   bump) → the vendor's review question closed `converted` → a `retroLinkedAt` marker.
 *
 * Cost shape: one convert is a bounded one-time cost and writes NOTHING per document through
 * triggers — every write is stamped (`syncRunId` on the record, `assignRunId` on transactions), 0
 * jobs, 1 derive bump, no transfer re-check, no classifier run. A timeout leaves a record without
 * `retroLinkedAt`; the next tap RESUMES it (never a second bill) — and never reopens a bill the
 * user removed meanwhile.
 *
 * @module orchestrators/recurring/convert_transaction_to_recurring
 */

import { randomUUID } from "crypto";
import {
  TraceContext,
  ConvertRefusedError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../../types";
import { create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { convert_recurring_repo } from "../../repositories/convert_recurring.repo";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import { resolve_convert_facts } from "../../resolvers/recurring/convert.resolver";
import { plan_convert, ConvertRequest, direction_of } from "../../domain/recurring/convert_plan.service";
import { ConvertDirection, ConvertFrequency } from "../../domain/recurring/convert_recurring.service";
import { is_own_review_item_id, plan_convert_review, suggested_item_id } from "../../domain/recurring/convert_review.service";
import { apply_review_state_change } from "../../domain/recurring/review_item.service";
import { generate_periods_inline } from "./generate_periods_inline";
import { assign_transactions_batch_orchestrator } from "../transactions/assign_transactions_batch.orchestrator";
import { follow_ups_from_written, run_sync_follow_ups } from "../plaid/sync_follow_ups";
import { plan_merge_old_into_new } from "../../domain/recurring/merge.service";
import { enqueue_reassign_user } from "../transactions/reassign_user.orchestrator";

export interface ConvertInput {
  transaction_id: string;
  split_id?: string;
  name: string;
  amount: number;
  frequency: ConvertFrequency;
  next_due_date: string;
  link_past: boolean;
  review_item_id?: string;
}

export interface ConvertResult {
  id: string;
  direction: ConvertDirection;
  /** An earlier tap already created it (a double tap / a resumed convert). */
  already: boolean;
  /** Past payments linked in addition to the source (D46: one per occurrence). */
  linked_past_count: number;
  first_date_ms: number | null;
  next_due_ms: number | null;
  next_due_clamped: boolean;
}

export async function convert_transaction_to_recurring_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: ConvertInput,
  now_ms: number
): Promise<ConvertResult> {
  const span = create_span(ctx, "orchestrator", "convert_transaction_to_recurring");
  log_operation_start(span, user_id);
  let created: { id: string; direction: ConvertDirection } | null = null;
  let follow_up_done = false;
  try {
    if (!(await is_convert_to_recurring_enabled(user_id))) {
      throw new ConvertRefusedError("FEATURE_OFF", "Making a transaction a bill isn't available on this account yet");
    }
    if (await is_user_purging(user_id)) throw new ConvertRefusedError("PURGING", "This account is being erased");
    // The client's review item must be this user's own, before anything is read for it.
    if (input.review_item_id !== undefined && !is_own_review_item_id(user_id, input.review_item_id)) {
      throw new ValidationError(["That suggestion doesn't belong to you"]);
    }

    // 1. Resolve — owner first; nothing else is read for someone else's transaction.
    const r = await resolve_convert_facts(ctx, user_id, input.transaction_id, now_ms);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundError("transaction", input.transaction_id);
      throw new PermissionDeniedError("convert_transaction_to_recurring", input.transaction_id);
    }

    // A record already made from this transaction: resume it (never a second bill).
    if (r.existing_conversion) {
      if (!r.existing_conversion.live) {
        throw new ConvertRefusedError("ALREADY_TRACKED", "This was already made into a bill", {
          id: r.existing_conversion.id, name: r.existing_conversion.name,
        });
      }
      const direction = direction_of(r.facts.txn.type) as ConvertDirection;
      created = { id: r.existing_conversion.id, direction };
      if (!r.existing_conversion.retro_done) {
        const resumed = await complete_convert(ctx, user_id, direction, r.existing_conversion.id, now_ms, null);
        follow_up_done = true;
        return { ...resumed, already: true };
      }
      return { id: r.existing_conversion.id, direction, already: true, linked_past_count: 0, first_date_ms: null, next_due_ms: null, next_due_clamped: false };
    }

    // 2. Plan (pure).
    const id = `conv_${randomUUID()}`;
    const req: ConvertRequest = {
      split_id: input.split_id, name: input.name, amount: input.amount, frequency: input.frequency,
      next_due_date: input.next_due_date, link_past: input.link_past,
    };
    const plan = plan_convert(r.facts, req, id);
    if (!plan.ok) {
      if (plan.code === "VALIDATION_ERROR") throw new ValidationError([plan.message]);
      if (plan.code === "NOT_FOUND") throw new NotFoundError("transaction_split", input.split_id ?? "");
      throw new ConvertRefusedError(plan.code, plan.message, plan.details);
    }
    // The vendor's open question (looked up by its deterministic id, plus the one the app named).
    const by_vendor_id = suggested_item_id(user_id, plan.direction, plan.vendor_key);
    const wanted = [by_vendor_id, ...(input.review_item_id ? [input.review_item_id] : [])];
    const items = await recurring_review_repo.get_items_by_ids(ctx, wanted);
    const review = plan_convert_review(
      user_id, plan.direction, plan.vendor_key,
      input.review_item_id ? items.get(input.review_item_id) ?? null : null,
      items.get(by_vendor_id) ?? null,
      input.review_item_id !== undefined, now_ms
    );
    if (!review.ok) throw new ValidationError([review.error]);

    // 3. Write: the record + the source pin, atomically. The retro-linked Plaid ids ride on the
    //    record from the start, so D1 keeps those past payments linked on every later pass.
    const run_id = `convert_${randomUUID()}`;
    const entity = {
      ...plan.entity,
      ...(plan.retro_plaid_ids.length ? { retro_txn_ids: plan.retro_plaid_ids } : {}),
    };
    const result = await convert_recurring_repo.create_with_source_pin(ctx, {
      direction: plan.direction, entity, user_id, run_id,
      source_txn_doc_id: input.transaction_id, source_split_ids: plan.source_split_ids,
    });
    if (result.status === "already_tracked") {
      throw new ConvertRefusedError("ALREADY_TRACKED", `This is already part of ${result.existing_name || "a bill"}`, {
        id: result.existing_id, name: result.existing_name,
      });
    }
    created = { id, direction: plan.direction };

    // 4–6. Periods, the chosen past payments, the single follow-up pass, the marker.
    await complete_convert(ctx, user_id, plan.direction, id, now_ms, {
      run_id, record: result.record, source: { doc_id: input.transaction_id, before: result.source_before, after: result.source_after },
      retro_doc_ids: plan.retro_doc_ids,
    });
    follow_up_done = true;

    // 6b. D41 — an old, turned-off / stale record of the same vendor on this account is the same
    //     bill: the user tapped Convert, so it ends at its last payment and merges into the new one
    //     (kept active, out of the Removed list, undoable). History moves nowhere: the retro-link
    //     skipped its payments.
    if (r.old_bills.length > 0) {
      const repo = plan.direction === "outflow" ? outflow_repo : inflow_repo;
      const month_start = Date.UTC(new Date(now_ms).getUTCFullYear(), new Date(now_ms).getUTCMonth(), 1);
      let from_ms = month_start;
      for (const old of r.old_bills) {
        const mp = plan_merge_old_into_new(old, id, now_ms, month_start);
        if (!mp) continue;
        await repo.apply_merge(ctx, old.id, { intervals: mp.intervals, merged_into_id: id, merge_log: mp.merge_log }, run_id);
        await repo.apply_period_suppression(ctx, old.id, mp.intervals, user_id);
        from_ms = Math.min(from_ms, mp.intervals[mp.intervals.length - 1].from_ms);
      }
      await enqueue_reassign_user({
        user_id, reason: "recurring_removal", scope: { account_ids: [plan.entity.account_id], from_ms },
      }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] convert merge re-assign enqueue failed:`, e));
      await bump_derive_version(user_id).catch(() => {});
    }

    // 7. The vendor's question: closed `converted`; its held-out payments released; a "Not a bill"
    //    memory forgotten. Guarded state write (a racing sync's change is never lost).
    if (review.items.length > 0) await recurring_review_repo.upsert_items(ctx, review.items);
    const current = await recurring_review_repo.get_state(ctx, user_id);
    if (apply_review_state_change(current, user_id, review.state_change).changed) {
      const next = await recurring_review_repo.apply_state_change(ctx, user_id, review.state_change);
      if (next.suppressed_changed) await bump_derive_version(user_id).catch(() => {});
    }

    log_operation_success(span, user_id);
    return {
      id, direction: plan.direction, already: false, linked_past_count: plan.retro_doc_ids.length,
      first_date_ms: plan.first_date_ms, next_due_ms: plan.next_due_ms, next_due_clamped: plan.next_due_clamped,
    };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  } finally {
    // The bill (and its pin) exist but the follow-up never ran: the one bump still lands.
    if (created && !follow_up_done) await bump_derive_version(user_id).catch(() => {});
  }
}

/**
 * The steps after the record exists — shared by a fresh convert and a resume: stored periods, the
 * past payments the record lists (`retroTxnIds`) assigned in memory, ONE follow-up pass, then the
 * `retroLinkedAt` marker. Idempotent: periods are generated only when none exist; the engine
 * writes only what changes; the marker is stamped so no trigger fans out.
 */
async function complete_convert(
  ctx: TraceContext,
  user_id: string,
  direction: ConvertDirection,
  id: string,
  now_ms: number,
  fresh: null | {
    run_id: string;
    record: Record<string, unknown>;
    source: { doc_id: string; before: Record<string, unknown>; after: Record<string, unknown> };
    retro_doc_ids: string[];
  }
): Promise<ConvertResult> {
  const repo = direction === "outflow" ? outflow_repo : inflow_repo;
  const run_id = fresh?.run_id ?? `convert_resume_${randomUUID()}`;
  // A resume reads the stored record (and its listed past payments); a fresh convert already has them.
  const stored = fresh ? null : await repo.get_raw_by_ids(ctx, [id]).then((m) => m.get(id) ?? null);
  const record = fresh?.record ?? stored;
  if (!record) throw new NotFoundError(direction, id);
  const retro_doc_ids = fresh
    ? fresh.retro_doc_ids
    : (await transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, (record.retroTxnIds as string[] | undefined) ?? []))
      .filter((t) => t.isActive !== false).map((t) => t.id);

  // 4. Stored periods (the create trigger skips a stamped record).
  const has_periods = fresh ? false : await repo.has_periods(ctx, id);
  if (!has_periods) {
    await generate_periods_inline(ctx, user_id, [{ id, kind: direction, created: true, before: null, after: record }]);
  }

  // 5. The chosen past payments: assigned IN MEMORY by the engine (D1 links them), written once,
  //    stamped; candidates scoped to this record only.
  const written: SyncWrittenDoc[] = fresh
    ? [{ doc_id: fresh.source.doc_id, before: fresh.source.before, after: fresh.source.after }]
    : [];
  if (retro_doc_ids.length > 0) {
    await assign_transactions_batch_orchestrator(ctx, {
      user_id, transaction_ids: retro_doc_ids, run_id, collect_into: written,
      candidate_outflow_ids: direction === "outflow" ? [id] : [],
      candidate_inflow_ids: direction === "inflow" ? [id] : [],
    });
  }

  // 6. ONE follow-up pass: reconcile the record, recompute only the touched budget periods, one
  //    derive bump. No transfer re-check (a loan vendor must not force a 180-day classifier scan).
  const f = follow_ups_from_written(written);
  await run_sync_follow_ups(ctx, user_id, {
    ...f,
    outflow_ids: direction === "outflow" ? [...new Set([...f.outflow_ids, id])] : f.outflow_ids,
    inflow_ids: direction === "inflow" ? [...new Set([...f.inflow_ids, id])] : f.inflow_ids,
    transactions_changed: true,
    recurring_changed: false,
    transfers_changed: false,
  }, { preload_budget_window: true });

  // 7. The marker (stamped: no trigger work).
  await repo.mark_retro_linked(ctx, id, now_ms, `convert_done_${randomUUID()}`);
  return {
    id, direction, already: false, linked_past_count: retro_doc_ids.length,
    first_date_ms: (record.firstDate as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    next_due_ms: (record.predictedNextDate as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
    next_due_clamped: false,
  };
}
