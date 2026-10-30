/**
 * Stored shape + transactional write of "Mark as paid / received" marks
 * (`manualSettledOccurrences` on an `outflows` / `inflows` DEFINITION doc).
 *
 * Shared by `outflow_repo` and `inflow_repo` so both store the same shape. The map is user state:
 * each repo's Plaid `save_batch` carries it over from the stored doc (Plaid never sets it).
 *
 * @module repositories/manual_settlement_doc
 */
import { Timestamp } from "firebase-admin/firestore";
import { ManualSettledOccurrences, ManualSettlementMark } from "../domain/recurring/manual_settlement.service";
/** Stored (camelCase) shape of one mark. */
export interface ManualSettledOccurrenceDoc {
    amount: number;
    markedAt: Timestamp | null;
    markedBy: string | null;
}
export type ManualSettledOccurrencesDoc = Record<string, ManualSettledOccurrenceDoc>;
/** Stored marks → domain marks (absent → empty). Malformed entries are dropped. */
export declare function map_manual_settled_occurrences(docs: ManualSettledOccurrencesDoc | undefined): ManualSettledOccurrences;
/**
 * Set (mark) or clear (null) ONE occurrence's mark on a definition doc, in a Firestore
 * transaction (read → field-path update, so a concurrent Plaid re-save / another mark can't be
 * lost or resurrect a cleared one). Returns the doc's marks before and after, for the audit.
 * Throws when the doc doesn't exist.
 */
export declare function write_manual_settlement(collection: "outflows" | "inflows", id: string, date_key: string, mark: {
    amount: number;
    marked_by: string;
} | null): Promise<{
    before: ManualSettledOccurrencesDoc;
    after: ManualSettledOccurrencesDoc;
}>;
/** Re-exported for repo entity typing. */
export type { ManualSettledOccurrences, ManualSettlementMark };
//# sourceMappingURL=manual_settlement_doc.d.ts.map