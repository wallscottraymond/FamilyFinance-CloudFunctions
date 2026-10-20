/**
 * Convert-To-Recurring repository: the ATOMIC create of a converted bill / income together with its
 * source split's pin — one Firestore transaction (review item 4). It reads the source transaction,
 * refuses when a split of it already pays a live record (the double tap, D44: only a transaction
 * already linked to a live bill is refused), then creates the record (stamped with the creator's
 * run id so the create / update triggers skip it) and pins the split(s) (the transaction write is
 * stamped `assignRunId`, so `on_transaction_written` skips it too). The creator then generates the
 * periods and runs ONE follow-up pass.
 *
 * @module repositories/convert_recurring
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext, NotFoundError, PermissionDeniedError } from "../types";
import type { InflowForPersistence, OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
import { is_removed_now } from "../domain/recurring/recurring_suppression.service";
import { apply_source_pin, ConvertDirection } from "../domain/recurring/convert_recurring.service";
import { record_audit_entry_async } from "../audit";
import { outflow_repo } from "./outflow.repo";
import { inflow_repo } from "./inflow.repo";

/** At least the callable timeout (300 s) with margin: a resume never overlaps a slow original. */
export const RESUME_LEASE_MS = 330_000;

export type CreateConvertedResult =
  | {
    status: "created";
    id: string;
    /** The record as stored (for inline period generation). */
    record: Record<string, unknown>;
    /** The source transaction before / after the pin (the follow-up pass reads both). */
    source_before: Record<string, unknown>;
    source_after: Record<string, unknown>;
  }
  | { status: "already_tracked"; existing_id: string; existing_name: string }
  /** A simultaneous tap of the SAME transaction/split(s): its record exists (still being finished while the lease is live). */
  | { status: "already_converted"; existing_id: string; in_progress: boolean };

const live = (d: Record<string, unknown> | undefined): boolean =>
  !!d && d.isActive !== false && d.isHidden !== true && !d.mergedIntoId &&
  // a bill the user removed / ended right now isn't claiming anything (a paused one still is)
  !is_removed_now(
    ((d.removalIntervals as Array<{ fromMs: number; toMs: number | null; mode: string }> | undefined) ?? [])
      .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode as "all" | "going_forward" | "paused" })),
    Date.now()
  );

export const convert_recurring_repo = {
  /** Is this converted record one that never finished (no retro marker, no follow-ups marker)? */
  async is_unfinished(_ctx: TraceContext, direction: ConvertDirection, id: string): Promise<boolean> {
    const snap = await getFirestore().collection(direction === "outflow" ? "outflows" : "inflows").doc(id).get();
    const d = snap.data();
    return !!d && d.retroLinkedAtMs === undefined && d.followUpsDoneAtMs === undefined;
  },

  /**
   * Take the right to discard an unfinished conversion (one transaction, so two simultaneous taps
   * can't both): `claimed` (the lease now blocks a second tap), `in_progress` (a lease is live —
   * the convert may still be running), `finished` (it completed: not discardable) or `gone`
   * (somebody else already discarded it).
   */
  async claim_discard(
    _ctx: TraceContext, direction: ConvertDirection, id: string, now_ms: number
  ): Promise<"claimed" | "in_progress" | "finished" | "gone"> {
    const db = getFirestore();
    const ref = db.collection(direction === "outflow" ? "outflows" : "inflows").doc(id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "gone";
      const d = snap.data() as Record<string, unknown>;
      if (d.retroLinkedAtMs !== undefined || d.followUpsDoneAtMs !== undefined) return "finished";
      if (((d.resumeLeaseMs as number | undefined) ?? 0) > now_ms) return "in_progress";
      /* eslint-disable @typescript-eslint/naming-convention */
      tx.update(ref, { resumeLeaseMs: now_ms + RESUME_LEASE_MS, syncRunId: `discard_lease_${now_ms}`, lastWriteSource: "convert" });
      /* eslint-enable @typescript-eslint/naming-convention */
      return "claimed";
    });
  },

  /** Transactions whose splits still point at this record (denormalized link arrays). */
  async linked_txn_ids(_ctx: TraceContext, direction: ConvertDirection, id: string): Promise<string[]> {
    const snap = await getFirestore().collection("transactions")
      .where(direction === "outflow" ? "splitOutflowIds" : "splitInflowIds", "array-contains", id).select().get();
    return snap.docs.map((d) => d.id);
  },

  /** Delete a record's stored periods, then the record. */
  async delete_record_and_periods(ctx: TraceContext, direction: ConvertDirection, id: string, user_id: string): Promise<void> {
    const db = getFirestore();
    const periods = await db.collection(direction === "outflow" ? "outflow_periods" : "inflow_periods")
      .where(direction === "outflow" ? "outflowId" : "inflowId", "==", id).select().get();
    for (let i = 0; i < periods.docs.length; i += 400) {
      const batch = db.batch();
      for (const p of periods.docs.slice(i, i + 400)) batch.delete(p.ref);
      await batch.commit();
    }
    await (direction === "outflow" ? outflow_repo : inflow_repo).hard_delete(ctx, id, user_id).catch((e: Error) => {
      if (!/not found/i.test(e.message)) throw e; // a simultaneous discard got there first
    });
  },

  async create_with_source_pin(
    ctx: TraceContext,
    args: {
      direction: ConvertDirection;
      entity: OutflowForPersistence | InflowForPersistence;
      user_id: string;
      run_id: string;
      source_txn_doc_id: string;
      source_split_ids: string[];
    }
  ): Promise<CreateConvertedResult> {
    const db = getFirestore();
    const txn_ref = db.collection("transactions").doc(args.source_txn_doc_id);
    const coll = args.direction === "outflow" ? "outflows" : "inflows";
    const built = args.direction === "outflow"
      ? outflow_repo.build_new_doc(args.entity as OutflowForPersistence, args.run_id)
      : inflow_repo.build_new_doc(args.entity as InflowForPersistence, args.run_id);
    const link_field = args.direction === "outflow" ? "outflowId" : "inflowId";

    const result = await db.runTransaction(async (tx): Promise<CreateConvertedResult> => {
      const snap = await tx.get(txn_ref);
      if (!snap.exists) throw new NotFoundError("transaction", args.source_txn_doc_id);
      const before = snap.data() as Record<string, unknown>;
      const owner = (before.ownerId as string | undefined) ?? (before.userId as string | undefined);
      if (owner !== args.user_id) throw new PermissionDeniedError("convert_transaction_to_recurring", args.source_txn_doc_id);
      const splits = (before.splits as Array<Record<string, unknown>> | undefined) ?? [];
      const targets = splits.filter((s) => args.source_split_ids.includes(s.splitId as string));
      if (targets.length === 0) throw new NotFoundError("transaction_split", args.source_split_ids.join(","));

      // A split already paying a LIVE record of this kind → refuse (read inside the transaction).
      const linked = [...new Set(targets.map((s) => s[link_field] as string | undefined).filter((x): x is string => !!x))];
      for (const id of linked) {
        const other = await tx.get(db.collection(coll).doc(id));
        const d = other.exists ? (other.data() as Record<string, unknown>) : undefined;
        if (live(d)) {
          const same_source = d?.convertedFromTxnId === args.source_txn_doc_id &&
            ((d?.convertedFromSplitIds as string[] | undefined) ?? []).some((x) => args.source_split_ids.includes(x));
          if (same_source) {
            const lease = (d?.resumeLeaseMs as number | undefined) ?? 0;
            return { status: "already_converted", existing_id: id, in_progress: lease > Date.now() && d?.retroLinkedAtMs === undefined };
          }
          return {
            status: "already_tracked",
            existing_id: id,
            existing_name: String(d?.userCustomName ?? d?.merchantName ?? d?.description ?? ""),
          };
        }
      }

      const now = Timestamp.now();
      const new_splits = splits.map((s) =>
        args.source_split_ids.includes(s.splitId as string) ? apply_source_pin(s, args.direction, args.entity.id) : s);
      const ids = (field: "outflowId" | "inflowId") =>
        Array.from(new Set(new_splits.map((s) => s[field] as string | undefined).filter((x): x is string => !!x)));
      /* eslint-disable @typescript-eslint/naming-convention */
      const update = {
        splits: new_splits,
        splitOutflowIds: ids("outflowId"),
        splitInflowIds: ids("inflowId"),
        // Stamped: `on_transaction_written` skips it; the creator runs the one follow-up pass.
        assignRunId: args.run_id,
        lastWriteSource: "assignment",
        updatedAt: now,
        updatedBy: args.user_id,
      };
      /* eslint-enable @typescript-eslint/naming-convention */
      // The convert is in progress: a tap during it (or until the lease runs out) resumes nothing.
      const source_budgets = [...new Set(targets.flatMap((s) => [s.budgetId as string | undefined, ...(((s.budgetIds as string[] | undefined) ?? []))])
        .filter((b): b is string => !!b && b !== "unassigned"))];
      tx.create(built.ref, {
        ...built.data,
        resumeLeaseMs: Date.now() + RESUME_LEASE_MS,
        convertAttempts: 1,
        ...(source_budgets.length ? { convertedSourceBudgetIds: source_budgets } : {}),
      });
      tx.update(txn_ref, update);
      return {
        status: "created",
        id: args.entity.id,
        record: built.data,
        source_before: before,
        source_after: { ...before, ...update },
      };
    });

    if (result.status === "created") {
      record_audit_entry_async({
        user_id: args.user_id,
        action: "create",
        entity_type: args.direction === "outflow" ? "recurring_outflow" : "recurring_inflow",
        entity_id: args.entity.id,
        before: null,
        after: result.record,
        trace_id: ctx.trace_id,
        metadata: { source: "api", context: { operation: "convert_transaction_to_recurring" } },
      });
    }
    return result;
  },
};
