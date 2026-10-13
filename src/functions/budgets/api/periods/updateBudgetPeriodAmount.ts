/**
 * Update Budget Period Amount
 *
 * Callable behind the budget period amount editor. Every mode is defined against THE period
 * page's allocation rule (domain/budgets/period_allocation_view): the page builds every view's
 * allocation from the budget's MONTHLY `budget_periods` docs, so that is where edits land.
 *
 * - 'this_period' ("This Period Only"), any budget cadence, any edited period type: the page's
 *   current amount for the edited period (excluding its own earlier adjustment) is compared with
 *   the typed amount and the difference is stored as ONE adjustment
 *   `{ periodId, startMs, endMs, amount }` in `periodAdjustments` on the monthly doc(s) the
 *   period overlaps (split by overlap days, cents-exact, when it spans two months). Re-editing the
 *   same period REPLACES its adjustment (sets, never accumulates). The edited period's own doc
 *   gets `hasPeriodAdjustment` — the app's "custom amount" marker (a separate field, NOT
 *   `isModified`, so the legacy modifiedAmount sync trigger never fires and a stale legacy
 *   `modifiedAmount` can't be revived).
 * - `reset: true` ("Reset to Original"): removes the edited period's adjustment(s) and clears a
 *   legacy `modifiedAmount` / `isModified` on the edited doc.
 * - 'all_forward' ("All Periods Forward"): the budget's amount becomes typed ÷ the edited
 *   period's page share (domain/budgets/period_share), every override / adjustment from the edited
 *   period on is cleared, and the periods are re-allocated with the shared domain
 *   `compute_reallocated_periods` — so the edited period then shows what was typed.
 *
 * Past periods (ended before today, UTC) can't be edited. Every write path bumps the owner's
 * derive version AFTER writing (derive caches live 24h).
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onCall, CallableRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Budget, BudgetPeriodDocument, UserRole } from "../../../../types";
import { authenticateRequest } from "../../../../utils/auth";
import { create_trace_context } from "../../../observability";
import { group_repo } from "../../../repositories/sharing";
import { allocation_update_fields } from "../../../repositories/budget_period.repo";
import { bump_derive_version } from "../../../repositories/derive_version.repo";
import { create_job_if_not_exists } from "../../../infrastructure/job_queue";
import { can_manage_budget, group_id_of_key } from "../../../domain/sharing/budget_view.service";
import { page_share } from "../../../domain/budgets/period_share.service";
import {
  direct_period_override,
  period_allocation,
} from "../../../domain/budgets/period_override.service";
import {
  bucket_allocation,
  MonthlyPeriodForDerivation,
  overlap_days,
  rebase_reallocated_periods,
  round2,
  split_adjustment_by_month,
  utc_day_index,
} from "../../../domain/budgets/period_allocation_view.service";
import {
  budget_cadence_to_instance,
  compute_reallocated_periods,
  PeriodInstanceType,
} from "../../../domain/budgets/period_generation.service";
import { BudgetPeriodType } from "../../../types/budgets/budget_entity.types";

// ============================================================================
// TYPES
// ============================================================================

type CascadeScope = "this_period" | "all_forward";

interface UpdateBudgetPeriodAmountRequest {
  budgetPeriodId: string;
  /** Not needed with `reset`. */
  newAmount?: number;
  /** Not needed with `reset` (a reset is always "This Period Only"). */
  cascadeScope?: CascadeScope;
  /** "Reset to Original": drop this period's "This Period Only" amount. */
  reset?: boolean;
}

interface UpdateBudgetPeriodAmountResponse {
  success: boolean;
  periodsUpdated: number;
  budgetUpdated: boolean;
  warnings: string[];
  error?: string;
}

/* eslint-disable @typescript-eslint/naming-convention */
/** Firestore shape of one `periodAdjustments[]` entry. */
interface StoredAdjustment {
  periodId: string;
  startMs: number;
  endMs: number;
  amount: number;
}
/* eslint-enable @typescript-eslint/naming-convention */

type DocData = Record<string, unknown>;

const COLLECTION = "budget_periods";
const DAY_MS = 86_400_000;

// ============================================================================
// HELPERS
// ============================================================================

/** Today's date at midnight UTC, epoch ms. */
function today_utc_ms(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Past = the period ended before today (UTC). */
function is_past_period(period_end: Timestamp): boolean {
  return period_end.toMillis() < today_utc_ms();
}

const ms_of = (v: unknown): number => (v as Timestamp).toMillis();

/** The stored adjustments on a doc (malformed entries dropped). */
function stored_adjustments(data: DocData): StoredAdjustment[] {
  const raw = (data.periodAdjustments as StoredAdjustment[] | undefined) ?? [];
  return raw.filter(
    (a) =>
      a &&
      typeof a.periodId === "string" &&
      typeof a.startMs === "number" &&
      typeof a.endMs === "number" &&
      typeof a.amount === "number"
  );
}

/** A monthly doc as THE page reads it (base amounts + adjustments), minus one periodId's. */
function to_monthly_for_derivation(
  data: DocData,
  exclude_period_id: string
): MonthlyPeriodForDerivation {
  const base =
    direct_period_override(data) ?? (data.allocatedAmount as number | undefined) ?? 0;
  const rolled = (data.rolledOverAmount as number | undefined) ?? 0;
  return {
    allocated_amount: base,
    effective_amount: base + rolled,
    start_ms: ms_of(data.periodStart),
    end_ms: ms_of(data.periodEnd),
    adjustments: stored_adjustments(data)
      .filter((a) => a.periodId !== exclude_period_id)
      .map((a) => ({
        period_id: a.periodId,
        start_ms: a.startMs,
        end_ms: a.endMs,
        amount: a.amount,
      })),
  };
}

/** `remaining` for a doc once `changes` are applied (allocation incl. adjustments + rollover). */
function remaining_after(data: DocData, changes: DocData): number {
  const next = { ...data, ...changes };
  const rolled = (next.rolledOverAmount as number | undefined) ?? 0;
  const spent = (next.spent as number | undefined) ?? 0;
  return round2(period_allocation(next) + rolled - spent);
}

/** Months (by UTC day) of [start, end] no monthly doc covers, as "YYYY-MM". */
function uncovered_months(start_ms: number, end_ms: number, months: DocData[]): string[] {
  const missing = new Set<string>();
  for (let day = utc_day_index(start_ms); day <= utc_day_index(end_ms); day++) {
    const covered = months.some(
      (m) => utc_day_index(ms_of(m.periodStart)) <= day && utc_day_index(ms_of(m.periodEnd)) >= day
    );
    if (!covered) missing.add(new Date(day * DAY_MS).toISOString().slice(0, 7));
  }
  return [...missing];
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export const updateBudgetPeriodAmount = onCall<
  UpdateBudgetPeriodAmountRequest,
  Promise<UpdateBudgetPeriodAmountResponse>
>({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
}, async (request: CallableRequest<UpdateBudgetPeriodAmountRequest>) => {
  const { budgetPeriodId, cascadeScope } = request.data;
  const reset = request.data.reset === true;
  const warnings: string[] = [];

  try {
    // ========================================================================
    // VALIDATION
    // ========================================================================

    if (!budgetPeriodId) {
      throw new HttpsError("invalid-argument", "budgetPeriodId is required");
    }
    const raw_amount = request.data.newAmount;
    if (!reset) {
      if (typeof raw_amount !== "number" || !Number.isFinite(raw_amount)) {
        throw new HttpsError("invalid-argument", "newAmount must be a valid number");
      }
      if (raw_amount < 0) {
        throw new HttpsError("invalid-argument", "newAmount cannot be negative");
      }
      if (!cascadeScope || !["this_period", "all_forward"].includes(cascadeScope)) {
        throw new HttpsError(
          "invalid-argument",
          "cascadeScope must be \"this_period\" or \"all_forward\""
        );
      }
    }
    const new_amount = round2(raw_amount ?? 0);

    // ========================================================================
    // AUTHENTICATION
    // ========================================================================

    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const db = admin.firestore();

    console.log(
      `[updateBudgetPeriodAmount] User ${user.uid} period ${budgetPeriodId}: ` +
      (reset ? "reset" : `$${new_amount} (scope: ${cascadeScope})`)
    );

    // ========================================================================
    // GET BUDGET PERIOD & BUDGET
    // ========================================================================

    const periodDoc = await db.collection(COLLECTION).doc(budgetPeriodId).get();
    if (!periodDoc.exists) {
      throw new HttpsError("not-found", "Budget period not found");
    }
    const period = { id: periodDoc.id, ...periodDoc.data() } as BudgetPeriodDocument;

    const budgetDoc = await db.collection("budgets").doc(period.budgetId).get();
    if (!budgetDoc.exists) {
      throw new HttpsError("not-found", "Parent budget not found");
    }
    const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

    // Ownership: the parent budget's CURRENT view (userId) — the caller's Me, or a group
    // they're in (Account-Rooted-Sharing PD6). Not createdBy, and no role bypass: every
    // user is an EDITOR, so a role check let anyone edit anyone's period. The admin SDK
    // skips rules, so this is the only guard.
    const owner_key = (budget as unknown as { userId?: string }).userId ?? "";
    const owner_gid = group_id_of_key(owner_key);
    const owner_group = owner_gid
      ? await group_repo.get(create_trace_context(false), owner_gid)
      : null;
    if (period.budgetId !== budget.id || !can_manage_budget(owner_key, user.uid, owner_group)) {
      throw new HttpsError("not-found", "Budget period not found");
    }

    if (is_past_period(period.periodEnd)) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot edit past/historical periods. Only current and future periods can be modified."
      );
    }

    if (budget.isSystemEverythingElse) {
      throw new HttpsError("failed-precondition", "Cannot edit \"Everything Else\" system budget");
    }

    const spent = period.spent || 0;
    if (!reset && new_amount < spent) {
      warnings.push(
        `Warning: New amount ($${new_amount.toFixed(2)}) is less than spent ` +
        `($${spent.toFixed(2)}). This will show as overspent.`
      );
    }

    // ========================================================================
    // EXECUTE UPDATE
    // ========================================================================

    let periodsUpdated = 0;
    let budgetUpdated = false;

    if (reset || cascadeScope === "this_period") {
      periodsUpdated = await set_this_period_amount(db, period, reset ? null : new_amount);
    } else {
      periodsUpdated = await set_all_periods_forward(db, budget.id!, period, new_amount);
      budgetUpdated = true;
    }

    // Derive caches live 24h — invalidate AFTER the writes landed (`periodAdjustments` isn't a
    // field the period-edit trigger watches, so nothing else bumps for it).
    await bump_derive_version(owner_key).catch(() => {});

    // The amount changed → a rollover budget's chain (allocation − spent carried forward) is
    // stale. Same async, deduped recompute the spend pipeline enqueues. Non-fatal.
    if ((budget as unknown as { rolloverEnabled?: boolean }).rolloverEnabled) {
      await create_job_if_not_exists(
        "recalculate_rollover",
        { user_id: owner_key, budget_id: budget.id, deduplication_key: budget.id },
        { trace_id: `update_budget_period_amount_${budget.id}` }
      ).catch((e) => console.error("[updateBudgetPeriodAmount] rollover enqueue failed:", e));
    }

    console.log(
      `[updateBudgetPeriodAmount] ✓ ${periodsUpdated} periods updated, budget updated: ` +
      `${budgetUpdated}`
    );

    return { success: true, periodsUpdated, budgetUpdated, warnings };
  } catch (error: unknown) {
    console.error("[updateBudgetPeriodAmount] Error:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    const message = (error as { message?: string })?.message;
    throw new HttpsError("internal", message || "Failed to update budget period amount");
  }
});

// ============================================================================
// THIS PERIOD ONLY / RESET
// ============================================================================

/**
 * "This Period Only" (`new_amount`) or "Reset to Original" (`null`) for the edited period, any
 * type, any budget cadence — in ONE transaction (the monthly docs are re-read inside it).
 * Returns the number of docs written.
 */
async function set_this_period_amount(
  db: admin.firestore.Firestore,
  period: BudgetPeriodDocument,
  new_amount: number | null
): Promise<number> {
  const start_ms = period.periodStart.toMillis();
  const end_ms = period.periodEnd.toMillis();
  const edited_pid = period.periodId || period.sourcePeriodId;
  const edited_ref = db.collection(COLLECTION).doc(period.id!);
  const months_query = db
    .collection(COLLECTION)
    .where("budgetId", "==", period.budgetId)
    .where("periodType", "==", "monthly");

  return db.runTransaction(async (tx) => {
    const edited_snap = await tx.get(edited_ref);
    const months_snap = await tx.get(months_query);
    if (!edited_snap.exists) {
      throw new HttpsError("not-found", "Budget period not found");
    }
    const edited = edited_snap.data() as DocData;

    // The budget's monthly docs the edited period overlaps (derive's home for every view).
    const months = months_snap.docs.filter((d) => {
      const m = d.data();
      return overlap_days(ms_of(m.periodStart), ms_of(m.periodEnd), start_ms, end_ms) > 0;
    });

    // Every changed doc's fields, merged per doc id (the edited doc may be a monthly one).
    const writes = new Map<string, { ref: admin.firestore.DocumentReference; data: DocData }>();
    const write = (ref: admin.firestore.DocumentReference, data: DocData): void => {
      const cur = writes.get(ref.id);
      writes.set(ref.id, { ref, data: { ...(cur?.data ?? {}), ...data } });
    };
    const now = Timestamp.now();

    let parts: ReturnType<typeof split_adjustment_by_month> = [];
    if (new_amount !== null) {
      const missing = uncovered_months(start_ms, end_ms, months.map((d) => d.data()));
      if (missing.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          `This budget has no monthly period for ${missing.join(", ")} yet, so this period's ` +
          "amount can't be set. Try again after its periods are generated."
        );
      }
      // What the page shows for this period now, without this period's own earlier adjustment.
      const current = bucket_allocation(
        months.map((d) => to_monthly_for_derivation(d.data(), edited_pid)),
        start_ms,
        end_ms
      ).allocated;
      const delta = round2(new_amount - current);
      if (delta !== 0) {
        parts = split_adjustment_by_month(
          edited_pid,
          start_ms,
          end_ms,
          delta,
          months.map((d) => ({
            start_ms: ms_of(d.data().periodStart),
            end_ms: ms_of(d.data().periodEnd),
          }))
        );
      }
      console.log(
        `[updateBudgetPeriodAmount] This Period Only ${edited_pid}: page $${current} → ` +
        `$${new_amount} (adjustment ${delta} over ${parts.length} month(s))`
      );
    }

    // Replace this period's adjustment on every monthly doc it overlaps (sets, never accumulates).
    months.forEach((d, i) => {
      const data = d.data();
      const existing = stored_adjustments(data);
      const kept = existing.filter((a) => a.periodId !== edited_pid);
      /* eslint-disable @typescript-eslint/naming-convention */
      const added: StoredAdjustment[] = parts
        .filter((p) => p.month_index === i)
        .map((p) => ({
          periodId: p.adjustment.period_id,
          startMs: p.adjustment.start_ms,
          endMs: p.adjustment.end_ms,
          amount: p.adjustment.amount,
        }));
      /* eslint-enable @typescript-eslint/naming-convention */
      if (kept.length === existing.length && added.length === 0) return;
      const next = [...kept, ...added];
      /* eslint-disable @typescript-eslint/naming-convention */
      const changes: DocData = { periodAdjustments: next };
      write(d.ref, {
        periodAdjustments: next.length > 0 ? next : FieldValue.delete(),
        remaining: remaining_after(data, changes),
        updatedAt: now,
      });
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    // The edited doc: the "custom" marker (+ on reset, clear a legacy override).
    /* eslint-disable @typescript-eslint/naming-convention */
    if (new_amount !== null) {
      // (Never `isModified` / `lastModifiedAt`: those decide whether a legacy `modifiedAmount`
      // on the doc counts — direct_period_override — and `isModified` fires the legacy sync.)
      write(edited_ref, { hasPeriodAdjustment: parts.length > 0, updatedAt: now });
    } else {
      const clear: DocData = { hasPeriodAdjustment: false, updatedAt: now };
      if (edited.modifiedAmount !== undefined || edited.isModified === true) {
        // Legacy "This Period Only" on the doc itself.
        clear.modifiedAmount = FieldValue.delete();
        clear.isModified = false;
      }
      write(edited_ref, clear);
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    for (const { ref, data } of writes.values()) {
      tx.update(ref, data);
    }
    return writes.size;
  });
}

// ============================================================================
// ALL PERIODS FORWARD
// ============================================================================

/**
 * "All Periods Forward", in ONE Firestore transaction that re-reads the budget and its periods
 * (so a "This Period Only" landing meanwhile is never overwritten, and a failure leaves nothing
 * half-written — the transaction is all-or-nothing and retried on contention):
 *  - budget amount = typed ÷ the edited period's page share;
 *  - "forward" resets custom amounts: every legacy override on a period ending in / after the
 *    edited period's month, and every adjustment reaching that month (all of a straddling
 *    period's parts together), are cleared;
 *  - periods are re-allocated with the shared domain rule (as process_budget_updated does), and
 *    the adjustments it does NOT clear (earlier custom periods inside the re-allocated range) are
 *    rebased so they keep showing what the user typed (rebase_reallocated_periods).
 * Only the fields that change are written. Returns the number of period docs written.
 */
async function set_all_periods_forward(
  db: admin.firestore.Firestore,
  budget_id: string,
  period: BudgetPeriodDocument,
  new_amount: number
): Promise<number> {
  const start_ms = period.periodStart.toMillis();
  const edited_start_day_ms = utc_day_index(start_ms) * DAY_MS;
  const sd = new Date(edited_start_day_ms);
  const month_start_ms = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 1);
  // Cutoff = the start of the edited period's month — "forward" from the period edited, never
  // earlier months (editing June on Mar 15 leaves March–May as they are). The page spreads each
  // monthly home evenly over its days, so every prime feeding the edited period's month (e.g.
  // this month's weeks that already ended) must take the new amount or the edited period shows
  // a blend. (The budget write below only bumps the derive version via on_budget_written;
  // process_budget_updated is not enqueued by this callable.)
  const cutoff = Timestamp.fromMillis(month_start_ms);
  const budget_ref = db.collection("budgets").doc(budget_id);
  const periods_query = db.collection(COLLECTION).where("budgetId", "==", budget_id);

  return db.runTransaction(async (tx) => {
    const budget_snap = await tx.get(budget_ref);
    const snap = await tx.get(periods_query);
    if (!budget_snap.exists) throw new HttpsError("not-found", "Parent budget not found");
    const budget = budget_snap.data() as DocData;
    const cadence = String(budget.period || "monthly").toLowerCase();
    const share = page_share(start_ms, period.periodEnd.toMillis(), cadence);
    const new_budget_amount = share > 0 ? round2(new_amount / share) : new_amount;
    console.log(
      `[updateBudgetPeriodAmount] All Periods Forward ${period.periodId}: share ` +
      `${share.toFixed(6)} → budget $${budget.amount} → $${new_budget_amount}`
    );

    // Every period whose adjustment reaches the edited period's month.
    const cleared_pids = new Set<string>();
    for (const d of snap.docs) {
      for (const a of stored_adjustments(d.data())) {
        if (a.endMs >= month_start_ms) cleared_pids.add(a.periodId);
      }
    }

    // 1. The clears — per doc, only the fields that change; `after` = the doc once cleared.
    const changes = new Map<string, DocData>();
    const after = new Map<string, DocData>();
    const change = (id: string, fields: DocData): void => {
      changes.set(id, { ...(changes.get(id) ?? {}), ...fields });
    };
    /* eslint-disable @typescript-eslint/naming-convention */
    for (const d of snap.docs) {
      const data = d.data();
      const next: DocData = { ...data };
      const in_or_after_month = ms_of(data.periodEnd) >= month_start_ms;
      if (in_or_after_month && (data.modifiedAmount != null || data.isModified === true)) {
        change(d.id, { modifiedAmount: FieldValue.delete(), isModified: false });
        delete next.modifiedAmount;
        next.isModified = false;
      }
      const adjustments = stored_adjustments(data);
      const kept = adjustments.filter((a) => !cleared_pids.has(a.periodId));
      if (kept.length !== adjustments.length) {
        change(d.id, { periodAdjustments: kept.length > 0 ? kept : FieldValue.delete() });
        next.periodAdjustments = kept;
      }
      const pid = String(data.periodId ?? "");
      if (data.hasPeriodAdjustment === true && (in_or_after_month || cleared_pids.has(pid))) {
        change(d.id, { hasPeriodAdjustment: false });
      }
      after.set(d.id, next);
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    // 2. Re-allocate with the shared domain rule, rebasing the adjustments that remain.
    const computed = compute_reallocated_periods({
      new_amount: new_budget_amount,
      budget_cadence: budget_cadence_to_instance(cadence as BudgetPeriodType),
      cutoff,
      periods: snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          period_id: String(data.periodId ?? ""),
          period_type: data.periodType as PeriodInstanceType,
          start_date: data.periodStart as Timestamp,
          end_date: data.periodEnd as Timestamp,
          spent: (data.spent as number | undefined) ?? 0,
          rolled_over_amount: (data.rolledOverAmount as number | undefined) ?? 0,
          daily_rate: (data.dailyRate as number | undefined) ?? 0,
        };
      }),
    });
    if (computed.validation_errors) {
      throw new HttpsError("invalid-argument", computed.validation_errors.join("; "));
    }
    const updates = rebase_reallocated_periods(
      snap.docs.map((d) => {
        const data = after.get(d.id)!;
        return {
          id: d.id,
          start_ms: ms_of(data.periodStart),
          end_ms: ms_of(data.periodEnd),
          override: direct_period_override(data),
          allocated_amount: (data.allocatedAmount as number | undefined) ?? 0,
          adjustments: to_monthly_for_derivation(data, "").adjustments ?? [],
          rolled_over_amount: (data.rolledOverAmount as number | undefined) ?? 0,
          spent: (data.spent as number | undefined) ?? 0,
        };
      }),
      computed.entities ?? []
    );
    const now = Timestamp.now();
    for (const u of updates) change(u.id, allocation_update_fields(u, now));

    // 3. Write: the budget's new normal amount + each changed period, atomically.
    /* eslint-disable @typescript-eslint/naming-convention */
    tx.update(budget_ref, {
      amount: new_budget_amount,
      remaining: new_budget_amount - ((budget.spent as number | undefined) || 0),
      updatedAt: now,
    });
    for (const d of snap.docs) {
      const fields = changes.get(d.id);
      if (fields) tx.update(d.ref, { ...fields, updatedAt: now });
    }
    /* eslint-enable @typescript-eslint/naming-convention */
    return changes.size;
  });
}
