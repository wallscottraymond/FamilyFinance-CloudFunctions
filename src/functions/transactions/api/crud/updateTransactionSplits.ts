/**
 * Update Transaction Splits - Callable Cloud Function
 *
 * Callable version of updateTransaction for mobile app usage.
 * Updates transaction splits with budget assignment and validation.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Transaction, TransactionSplit } from "../../../../types";
import { getDocument, updateDocument } from "../../../../utils/firestore";
import { bump_derive_version } from "../../../repositories/derive_version.repo";
import * as admin from "firebase-admin";
import { create_trace_context, generate_id } from "../../../observability";
import { load_category_catalog } from "../../../resolvers/shared/category_catalog.resolver";
import { resolve_split_category_edit } from "../../../domain/transactions/split_category_edit.service";
import { create_in_memory_assigner } from "../../../orchestrators/transactions/assign_in_memory";
import {
  follow_ups_from_written,
  run_sync_follow_ups,
} from "../../../orchestrators/plaid/sync_follow_ups";

interface UpdateTransactionSplitsRequest {
  transactionId: string;
  splits: TransactionSplit[];
  userNotes?: string;
  isHidden?: boolean;
  isRecurring?: boolean;
}

interface UpdateTransactionSplitsResponse {
  success: boolean;
  transaction?: Transaction;
  message?: string;
}

/**
 * Update transaction splits via callable function
 *
 * This function:
 * 1. Validates user authentication and ownership
 * 2. Validates and assigns splits to budgets
 * 3. Updates the transaction in Firestore
 * 4. Updates budget spending calculations
 */
export const updateTransactionSplits = onCall<
  UpdateTransactionSplitsRequest,
  Promise<UpdateTransactionSplitsResponse>
>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  // Check authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = request.auth.uid;
  const { transactionId, splits, userNotes, isHidden, isRecurring } = request.data;

  // Validate required fields
  if (!transactionId) {
    throw new HttpsError("invalid-argument", "Transaction ID is required");
  }

  if (!splits || !Array.isArray(splits)) {
    throw new HttpsError("invalid-argument", "Splits array is required");
  }

  try {
    console.log(`[updateTransactionSplits] User ${userId} updating transaction ${transactionId} with ${splits.length} splits`);

    // Get existing transaction
    const existingTransaction = await getDocument<Transaction>("transactions", transactionId);
    if (!existingTransaction) {
      throw new HttpsError("not-found", "Transaction not found");
    }

    // Check ownership - user can only update their own transactions
    if (existingTransaction.ownerId !== userId && existingTransaction.userId !== userId) {
      console.log(`[updateTransactionSplits] Permission denied: user ${userId} does not own transaction ${transactionId}`);
      console.log(`[updateTransactionSplits] Transaction ownerId: ${existingTransaction.ownerId}, userId: ${existingTransaction.userId}`);
      throw new HttpsError("permission-denied", "Cannot update this transaction");
    }

    // Prepare update data - use Record type for flexibility with optional fields
    const updateData: Record<string, any> = {
      splits,
      updatedAt: admin.firestore.Timestamp.now(),
      updatedBy: userId,
    };

    // Add optional fields if provided
    if (userNotes !== undefined) {
      updateData.userNotes = userNotes;
    }
    if (isHidden !== undefined) {
      updateData.isHidden = isHidden;
    }
    if (isRecurring !== undefined) {
      updateData.isRecurring = isRecurring;
    }

    // Calculate split totals
    const totalAllocated = splits.reduce((sum, split) => sum + Math.abs(split.amount || 0), 0);
    updateData.isSplit = splits.length > 1;
    updateData.totalAllocated = totalAllocated;

    // Budget assignment is owned by the Transaction Assignment Engine:
    // `on_transaction_written` re-runs the engine after this write. Here we only normalize the
    // splits (ids, timestamps) and decide each split's CATEGORY fields with the one rule set
    // (domain/transactions/split_category_edit — canon M1/M2/M3): the app's pick (or an old
    // build's bare `categoryId`) becomes `categorySource: "user"` + `firstCategoryId`; the Plaid
    // codes stay immutable; the legacy `internal*` override is never written.
    const txn: any = existingTransaction;
    const catalog = await load_category_catalog(create_trace_context(false));
    const storedById = new Map<string, Record<string, unknown>>();
    for (const s of (txn.splits ?? []) as Array<Record<string, unknown>>) {
      const id = (s.splitId as string) || (s.id as string);
      if (id) storedById.set(id, s);
    }
    updateData.splits = updateData.splits.map((split: any, index: number) => {
      const now = admin.firestore.Timestamp.now();
      const splitId = split.splitId || split.id || `split_${Date.now()}_${index}`;
      const category = resolve_split_category_edit(split, storedById.get(splitId), txn, catalog);

      return {
        ...split,
        // Ensure ID exists (support both splitId and id field names)
        splitId: splitId,
        id: splitId,
        ...category,
        // Ensure timestamps
        createdAt: split.createdAt || now,
        updatedAt: now,
        // Ensure createdBy
        createdBy: split.createdBy || userId,
      };
    });

    // Split-Status-Actions: denormalize expected-returns aggregates from the final
    // splits (status derived from spendStatus, falling back to legacy booleans).
    const deriveStatus = (s: any): string =>
      (typeof s.spendStatus === "string" && s.spendStatus) ||
      (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted");
    updateData.returnAmount = updateData.splits.reduce(
      (sum: number, s: any) =>
        sum + (deriveStatus(s) === "refund" ? Math.abs(s.amount || 0) : 0),
      0
    );
    updateData.hasRefundSplits = updateData.splits.some(
      (s: any) => deriveStatus(s) === "refund"
    );
    updateData.hasIgnoredSplits = updateData.splits.some(
      (s: any) => deriveStatus(s) === "ignored"
    );

    // Edits apply IMMEDIATELY (canon O2, Transaction-Integrity-Review 3g): the engine assigns the
    // edited transaction IN MEMORY (we already hold it — no re-read), the doc is written ONCE with
    // its final assignment, stamped so `on_transaction_written` skips it, then ONE follow-up
    // (reconcile touched bills, recompute touched budget periods, one derive bump). Before: the
    // write queued a 15-s debounced re-assign that waited for the 5-minute sweep.
    const owner_id = (txn.userId as string) || userId;
    const tctx = create_trace_context(false);
    const txn_date_ms = (txn.transactionDate as admin.firestore.Timestamp | undefined)?.toMillis?.();
    const run_id = generate_id();
    let assigned_ok = false;
    if (txn_date_ms !== undefined) {
      try {
        const assign = await create_in_memory_assigner(tctx, owner_id, txn_date_ms, txn_date_ms);
        const assigned = await assign(transactionId, { ...txn, ...updateData });
        updateData.splits = assigned.splits;
        updateData.splitBudgetIds = assigned.splitBudgetIds;
        updateData.splitOutflowIds = assigned.splitOutflowIds;
        updateData.splitInflowIds = assigned.splitInflowIds;
        updateData.assignRunId = run_id;
        updateData.lastWriteSource = "split_edit";
        assigned_ok = true;
      } catch (error) {
        // Never lose the user's edit: write it unassigned-in-memory; the trigger re-assigns it.
        console.error(`[updateTransactionSplits] in-memory assignment failed; trigger will assign:`, error);
      }
    }

    // Update transaction in Firestore (using Admin SDK - bypasses security rules)
    const updatedTransaction = await updateDocument<Transaction>(
      "transactions",
      transactionId,
      updateData as any
    );

    console.log(`[updateTransactionSplits] Transaction ${transactionId} updated (assigned=${assigned_ok})`);

    if (assigned_ok) {
      // ONE follow-up for this write (it bumps the derive version once).
      await run_sync_follow_ups(
        tctx,
        owner_id,
        {
          ...follow_ups_from_written([
            { doc_id: transactionId, before: txn, after: { ...txn, ...updateData } },
          ]),
          // A split edit never changes amounts / dates / accounts of the transaction, so it
          // can't form or break a matched transfer pair — skip the transfer re-scan (reads).
          transfers_changed: false,
        }
      ).catch((error) => console.error("[updateTransactionSplits] follow-up failed:", error));
    } else {
      // Invalidate the derived-period cache so the period shows the edit right away.
      await bump_derive_version(owner_id).catch(() => {});
    }

    return {
      success: true,
      transaction: updatedTransaction,
      message: "Transaction updated successfully"
    };

  } catch (error: any) {
    console.error("[updateTransactionSplits] Error:", error);

    // Re-throw HttpsErrors as-is
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to update transaction splits");
  }
});
