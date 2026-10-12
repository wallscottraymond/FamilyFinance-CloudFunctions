/**
 * Sync follow-ups — the ONE pass that runs after a Plaid sync's writes.
 *
 * A sync stamps its transaction writes with `syncRunId`, so `on_transaction_written` skips them
 * (no per-transaction assignment job, no recompute-per-day job, no reconcile-per-write job).
 * Instead the sync collects what its writes affected and runs this once, inline:
 *
 *   1. reconcile each affected bill / income stream (paid / received status) — once per stream
 *   2. recompute `spent` for each affected budget, over exactly the periods its dates fall in
 *   3. re-check internal transfers when transactions or streams changed
 *   4. bump the derive version once
 *
 * For a 3,000-transaction first link this replaces ~690 queued jobs (each waiting for the
 * 5-minute sweep) with one pass that finishes in the same invocation.
 *
 * @module orchestrators/plaid/sync_follow_ups
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import { reconcile_recurring_periods_orchestrator } from "../recurring/reconcile_recurring_periods.orchestrator";
import { recompute_budget_spent_orchestrator } from "../budgets/recompute_budget_spent.orchestrator";
import { classify_internal_transfers_orchestrator } from "./classify_internal_transfers.orchestrator";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { coalesce_job } from "../../infrastructure/job_queue";

export interface SyncFollowUps {
  /** budget id → transaction dates (ms) whose periods need `spent` recomputed. */
  budget_dates: Record<string, number[]>;
  outflow_ids: string[];
  inflow_ids: string[];
  /** Any transaction written (drives the transfer re-check + derive bump). */
  transactions_changed: boolean;
  /** Bill / income streams created or changed (drives the transfer re-check + derive bump). */
  recurring_changed: boolean;
  /** A transfer transaction was written — the only kind that can form a new matched pair. */
  transfers_changed: boolean;
}

export const empty_follow_ups = (): SyncFollowUps => ({
  budget_dates: {},
  outflow_ids: [],
  inflow_ids: [],
  transactions_changed: false,
  recurring_changed: false,
  transfers_changed: false,
});

const ids_of = (doc: Record<string, unknown> | null, denorm: string, split_field: string): string[] => {
  if (!doc) return [];
  const d = doc[denorm] as string[] | undefined;
  if (d) return d;
  return ((doc.splits as Array<Record<string, unknown>> | undefined) ?? [])
    .map((s) => s[split_field] as string | undefined)
    .filter((id): id is string => !!id);
};

const date_of = (doc: Record<string, unknown> | null): number | null => {
  const t = doc?.transactionDate;
  return t instanceof Timestamp ? t.toMillis() : null;
};

/** What a set of transaction writes affects — before ∪ after, so an un-link or move is covered. */
export function follow_ups_from_written(written: SyncWrittenDoc[]): SyncFollowUps {
  const budget_dates = new Map<string, Set<number>>();
  const outflows = new Set<string>();
  const inflows = new Set<string>();
  let transfers_changed = false;
  for (const w of written) {
    const primary = String(w.after.plaidPrimaryCategory ?? "");
    if (primary.startsWith("TRANSFER") || primary === "LOAN_PAYMENTS") transfers_changed = true;
    for (const doc of [w.before, w.after]) {
      const ms = date_of(doc);
      if (ms !== null) {
        for (const b of ids_of(doc, "splitBudgetIds", "budgetId")) {
          if (b === "unassigned") continue;
          if (!budget_dates.has(b)) budget_dates.set(b, new Set());
          budget_dates.get(b)!.add(ms);
        }
      }
      ids_of(doc, "splitOutflowIds", "outflowId").forEach((id) => outflows.add(id));
      ids_of(doc, "splitInflowIds", "inflowId").forEach((id) => inflows.add(id));
    }
  }
  return {
    budget_dates: Object.fromEntries([...budget_dates].map(([k, v]) => [k, [...v]])),
    outflow_ids: [...outflows],
    inflow_ids: [...inflows],
    transactions_changed: written.length > 0,
    recurring_changed: false,
    transfers_changed,
  };
}

export function merge_follow_ups(a: SyncFollowUps, b: Partial<SyncFollowUps>): SyncFollowUps {
  const budget_dates: Record<string, number[]> = { ...a.budget_dates };
  for (const [k, v] of Object.entries(b.budget_dates ?? {})) {
    budget_dates[k] = [...new Set([...(budget_dates[k] ?? []), ...v])];
  }
  return {
    budget_dates,
    outflow_ids: [...new Set([...a.outflow_ids, ...(b.outflow_ids ?? [])])],
    inflow_ids: [...new Set([...a.inflow_ids, ...(b.inflow_ids ?? [])])],
    transactions_changed: a.transactions_changed || !!b.transactions_changed,
    recurring_changed: a.recurring_changed || !!b.recurring_changed,
    transfers_changed: a.transfers_changed || !!b.transfers_changed,
  };
}

const RECONCILE_CONCURRENCY = 4;

/** Run the follow-up pass once. Each step is non-fatal; a failed step falls back to a queued job. */
export async function run_sync_follow_ups(
  ctx: TraceContext,
  user_id: string,
  f: SyncFollowUps
): Promise<void> {
  const started = Date.now();

  // 1. Bills / income: one reconcile per affected stream.
  const streams = [
    ...f.outflow_ids.map((id) => ({ id, type: "outflow" as const })),
    ...f.inflow_ids.map((id) => ({ id, type: "inflow" as const })),
  ];
  for (let i = 0; i < streams.length; i += RECONCILE_CONCURRENCY) {
    await Promise.all(
      streams.slice(i, i + RECONCILE_CONCURRENCY).map(async (s) => {
        try {
          await reconcile_recurring_periods_orchestrator(ctx, {
            recurring_id: s.id,
            recurring_type: s.type,
            user_id,
            trace_id: ctx.trace_id,
          });
        } catch (error) {
          console.error(`[${ctx.trace_id}] follow-up reconcile ${s.type} ${s.id} failed; queued instead:`, error);
          await coalesce_job(
            "reconcile_recurring_period",
            {
              deduplication_key: `reconcile:${s.type}:${s.id}`,
              recurring_id: s.id,
              recurring_type: s.type,
              user_id,
              trace_id: ctx.trace_id,
            },
            { delay_seconds: 30, trace_id: ctx.trace_id }
          ).catch(() => {});
        }
      })
    );
  }

  // 2. Budgets: one recompute over exactly the periods the written dates fall in.
  const budget_ids = Object.keys(f.budget_dates);
  if (budget_ids.length > 0) {
    try {
      await recompute_budget_spent_orchestrator(ctx, {
        user_id,
        budget_ids,
        dates_ms_by_budget: f.budget_dates,
      });
    } catch (error) {
      console.error(`[${ctx.trace_id}] follow-up recompute failed; queued a full recompute instead:`, error);
      await coalesce_job(
        "recompute_budget_spent",
        { deduplication_key: `recompute_full:${user_id}`, user_id, budget_ids },
        { delay_seconds: 30, trace_id: ctx.trace_id }
      ).catch(() => {});
    }
  }

  // 3. Internal transfers — after BOTH transactions and streams are in place, so matched pairs
  //    can be found (it used to run inside the recurring sync, before a new item's history landed).
  if (f.transfers_changed || f.recurring_changed) {
    try {
      // Streams unchanged → the fingerprint can skip; new transfer txns → must re-pair.
      await classify_internal_transfers_orchestrator(ctx, user_id, Date.now(), {
        force: f.transfers_changed,
      });
    } catch (error) {
      console.error(`[${ctx.trace_id}] follow-up transfer check failed (non-fatal):`, error);
    }
  }

  // 4. One derive-cache invalidation for everything above.
  if (f.transactions_changed || f.recurring_changed) {
    await bump_derive_version(user_id).catch(() => {});
  }

  console.log(
    `[${ctx.trace_id}] sync follow-ups: streams=${streams.length}, budgets=${budget_ids.length}, ` +
    `took=${Date.now() - started}ms`
  );
}
