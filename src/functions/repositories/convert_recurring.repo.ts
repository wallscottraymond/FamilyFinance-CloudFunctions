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
  | { status: "already_tracked"; existing_id: string; existing_name: string };

const live = (d: Record<string, unknown> | undefined): boolean =>
  !!d && d.isActive !== false && d.isHidden !== true && !d.mergedIntoId &&
  // a bill the user removed / ended right now isn't claiming anything (a paused one still is)
  !is_removed_now(
    ((d.removalIntervals as Array<{ fromMs: number; toMs: number | null; mode: string }> | undefined) ?? [])
      .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode as "all" | "going_forward" | "paused" })),
    Date.now()
  );

export const convert_recurring_repo = {
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
      tx.create(built.ref, { ...built.data, resumeLeaseMs: Date.now() + RESUME_LEASE_MS });
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
