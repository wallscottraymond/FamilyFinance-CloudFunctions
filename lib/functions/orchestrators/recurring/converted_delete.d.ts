/**
 * Deleting a bill / income that others depend on (Convert-To-Recurring review item 9, P9, P10).
 *
 *   - Records MERGED INTO it (a same-bill merge or a convert over an old bill) are un-merged first:
 *     their intervals come back, so a hard delete never strands an old bill with a dangling
 *     `mergedIntoId` (hidden from Removed, no Restore, no undo target).
 *   - Plaid streams IT ABSORBED are remembered as declined: their vendor is written as "Not a bill"
 *     and their payments are held out of fuzzy matching, so the next sync never brings them back as
 *     a new Plaid bill (deleting the last converted bill would otherwise turn the absorber off and
 *     let the stream be saved).
 * Nothing happens for a record with neither (the common case: one query).
 *
 * @module orchestrators/recurring/converted_delete
 */
import { TraceContext } from "../../types";
export declare function handle_converted_delete(ctx: TraceContext, user_id: string, kind: "outflow" | "inflow", id: string): Promise<void>;
//# sourceMappingURL=converted_delete.d.ts.map