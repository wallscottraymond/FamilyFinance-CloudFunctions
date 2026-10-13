/**
 * Stored shape + transactional write of "Mark as paid / received" marks
 * (`manualSettledOccurrences` on an `outflows` / `inflows` DEFINITION doc).
 *
 * Shared by `outflow_repo` and `inflow_repo` so both store the same shape. The map is user state:
 * each repo's Plaid `save_batch` carries it over from the stored doc (Plaid never sets it).
 *
 * @module repositories/manual_settlement_doc
 */

import { FieldPath, FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  ManualSettledOccurrences,
  ManualSettlementMark,
} from "../domain/recurring/manual_settlement.service";

/** Stored (camelCase) shape of one mark. */
/* eslint-disable @typescript-eslint/naming-convention */
export interface ManualSettledOccurrenceDoc {
  amount: number;
  markedAt: Timestamp | null;
  markedBy: string | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

export type ManualSettledOccurrencesDoc = Record<string, ManualSettledOccurrenceDoc>;

/** Stored marks → domain marks (absent → empty). Malformed entries are dropped. */
export function map_manual_settled_occurrences(
  docs: ManualSettledOccurrencesDoc | undefined
): ManualSettledOccurrences {
  const out: ManualSettledOccurrences = {};
  for (const [key, d] of Object.entries(docs ?? {})) {
    if (!d || typeof d.amount !== "number" || !Number.isFinite(d.amount)) continue;
    const at = d.markedAt as { toMillis?: () => number } | null | undefined;
    out[key] = {
      amount: d.amount,
      marked_at_ms: at && typeof at.toMillis === "function" ? at.toMillis() : null,
      marked_by: d.markedBy ?? null,
    };
  }
  return out;
}

/**
 * Set (mark) or clear (null) ONE occurrence's mark on a definition doc, in a Firestore
 * transaction (read → field-path update, so a concurrent Plaid re-save / another mark can't be
 * lost or resurrect a cleared one). Returns the doc's marks before and after, for the audit.
 * Throws when the doc doesn't exist.
 */
export async function write_manual_settlement(
  collection: "outflows" | "inflows",
  id: string,
  date_key: string,
  mark: { amount: number; marked_by: string } | null
): Promise<{ before: ManualSettledOccurrencesDoc; after: ManualSettledOccurrencesDoc }> {
  const db = getFirestore();
  const ref = db.collection(collection).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(`${collection} ${id} not found`);
    }
    const stored = (snap.data() ?? {}).manualSettledOccurrences;
    const before = (stored ?? {}) as ManualSettledOccurrencesDoc;
    const after: ManualSettledOccurrencesDoc = { ...before };
    const now = Timestamp.now();
    if (mark) {
      /* eslint-disable @typescript-eslint/naming-convention */
      after[date_key] = { amount: mark.amount, markedAt: now, markedBy: mark.marked_by };
      /* eslint-enable @typescript-eslint/naming-convention */
    } else {
      delete after[date_key];
    }
    tx.update(
      ref,
      new FieldPath("manualSettledOccurrences", date_key),
      mark ? after[date_key] : FieldValue.delete(),
      "updatedAt",
      now
    );
    return { before, after };
  });
}

/** Re-exported for repo entity typing. */
export type { ManualSettledOccurrences, ManualSettlementMark };
