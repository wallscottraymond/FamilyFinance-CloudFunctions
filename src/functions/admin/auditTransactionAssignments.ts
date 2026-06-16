/**
 * Audit Transaction Assignments (read-only diagnostic)
 *
 * Dry-runs the Transaction Assignment Engine's pure category/budget matching
 * over EVERY active split and logs the ones whose CURRENT budget differs from
 * their natural category-home (the budget the engine would pick from category +
 * date alone, IGNORING any manual pin). This surfaces:
 *   - splits stuck in "Everything Else" whose category actually belongs to a
 *     real budget, and
 *   - whether each such split is a MANUAL PIN (budgetAssignmentSource ===
 *     "manual") — which the engine deliberately honors, so it will NOT re-home
 *     on its own.
 *
 * READ-ONLY: never writes. Logs one JSON line per mismatch (severity WARNING)
 * plus a summary line (severity NOTICE), so it stays well under log limits.
 *
 * Trigger (dev):
 *   GET https://us-central1-<project>.cloudfunctions.net/auditTransactionAssignments?userId=<uid>
 *
 * @module admin/auditTransactionAssignments
 */

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  match_budget,
  BudgetForMatch,
} from "../domain/transactions/match_budget.service";
import {
  match_category,
  CategoryRule,
} from "../domain/transactions/match_category.service";
import { create_job } from "../infrastructure/job_queue";
import { generate_id } from "../observability";

/* eslint-disable @typescript-eslint/naming-convention */

export const auditTransactionAssignments = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (req, res) => {
    const userId =
      (req.query.userId as string | undefined) ||
      (req.body?.userId as string | undefined);
    if (!userId) {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }

    const db = getFirestore();

    // 1. Budgets (real + Everything Else), reduced to the matcher's shape.
    const budgetsSnap = await db
      .collection("budgets")
      .where("userId", "==", userId)
      .where("isActive", "==", true)
      .get();

    const realBudgets: BudgetForMatch[] = [];
    const budgetNames = new Map<string, string>();
    let everythingElseId: string | null = null;

    for (const doc of budgetsSnap.docs) {
      const d = doc.data();
      budgetNames.set(doc.id, d.name ?? "(unnamed)");
      if (d.isSystemEverythingElse) {
        everythingElseId = doc.id;
        continue;
      }
      const endTs = (d.budgetEndDate ?? d.endDate) as Timestamp | undefined;
      realBudgets.push({
        id: doc.id,
        category_ids: (d.categoryIds as string[]) ?? [],
        start_ms: (d.startDate as Timestamp).toMillis(),
        end_ms: d.isOngoing ? null : endTs?.toMillis() ?? null,
        is_ongoing: !!d.isOngoing,
      });
    }

    // 2. Category upgrade rules (merchant / keyword), keyed by detailed enum.
    const catSnap = await db
      .collection("categories")
      .where("isActive", "==", true)
      .get();
    const categoryRules: CategoryRule[] = catSnap.docs.map((doc) => {
      const c = doc.data();
      return {
        category: doc.id,
        merchants: (c.merchants as string[]) ?? [],
        keywords: (c.keywords as string[]) ?? [],
      };
    });

    // 3. All of the user's transactions.
    const txnSnap = await db
      .collection("transactions")
      .where("userId", "==", userId)
      .get();

    let totalTxns = 0;
    let totalSplits = 0;
    let mismatches = 0;
    let pinnedMismatches = 0;
    let noDate = 0;

    for (const doc of txnSnap.docs) {
      const d = doc.data();
      if (d.isActive === false) {
        continue;
      }
      totalTxns++;

      const txnDate = (d.transactionDate ?? d.dateTransacted) as
        | Timestamp
        | undefined;
      if (!txnDate?.toMillis) {
        noDate++;
        continue;
      }
      const txnDateMs = txnDate.toMillis();
      const merchant = (d.merchantName as string | null) ?? null;
      const name = (d.name as string | null) ?? null;
      const splits = (d.splits as Array<Record<string, unknown>>) ?? [];

      for (const s of splits) {
        totalSplits++;
        const plaidCat = (s.plaidDetailedCategory as string) ?? "OTHER_EXPENSE";
        const internalCat = (s.internalDetailedCategory as string | null) ?? null;
        const currentBudget = (s.budgetId as string) ?? "unassigned";
        const source =
          (s.budgetAssignmentSource as "category" | "manual") ?? "category";

        // Effective category (may upgrade OTHER_EXPENSE via merchant/keyword).
        const resolvedCat = match_category(
          { plaid_match_category: plaidCat, merchant_name: merchant, name },
          categoryRules
        ).category;

        // Natural category-home, IGNORING any manual pin.
        const natural = match_budget(
          { internal_match_category: internalCat, plaid_match_category: resolvedCat },
          txnDateMs,
          realBudgets,
          everythingElseId
        );

        if (natural.budget_id !== currentBudget) {
          mismatches++;
          if (source === "manual") {
            pinnedMismatches++;
          }
          console.log(
            JSON.stringify({
              severity: "WARNING",
              message: "split misplaced vs category-home",
              userId,
              transaction_id: doc.id,
              merchant: merchant ?? name,
              txn_date: new Date(txnDateMs).toISOString().slice(0, 10),
              split_id: s.splitId ?? null,
              plaidDetailedCategory: plaidCat,
              internalDetailedCategory: internalCat,
              resolved_category: resolvedCat,
              current_budget: currentBudget,
              current_budget_name: budgetNames.get(currentBudget) ?? null,
              current_source: source,
              expected_budget: natural.budget_id,
              expected_budget_name: budgetNames.get(natural.budget_id) ?? null,
              expected_reason: natural.reason,
              pinned: source === "manual",
            })
          );
        }
      }
    }

    // Opt-in repair: enqueue the assignment backfill for this user. Re-runs the
    // engine on EVERY transaction; un-pinned splits re-home to their category
    // budgets. Manual pins (pinnedMismatches) are intentionally left in place.
    const fix = req.query.fix === "true" || req.body?.fix === true;
    let backfillEnqueued = false;
    if (fix) {
      const trace_id = generate_id();
      await create_job("backfill_assignments", { user_id: userId }, { trace_id });
      backfillEnqueued = true;
      console.log(
        JSON.stringify({
          severity: "NOTICE",
          message: "backfill enqueued from audit",
          userId,
          trace_id,
        })
      );
    }

    const summary = {
      severity: "NOTICE",
      message: "audit summary",
      userId,
      realBudgets: realBudgets.length,
      everythingElseId,
      totalTxns,
      totalSplits,
      mismatches,
      pinnedMismatches,
      categoryMismatches: mismatches - pinnedMismatches,
      txnsMissingDate: noDate,
      backfillEnqueued,
    };
    console.log(JSON.stringify(summary));

    res.status(200).json({ success: true, ...summary });
  }
);

/* eslint-enable @typescript-eslint/naming-convention */
