/**
 * Absorb, never save (Convert-To-Recurring D3 / D42) — PURE.
 *
 * When Plaid later detects the bill a user converted by hand, there must be ONE bill: the user's
 * (their name, amount, history). A NEW Plaid stream that is the same bill as a converted record —
 * same direction + account, and the stream's vendor is the record's vendor key (or its source
 * merchant's) — is not saved as a record of its own. It is recorded on the converted record
 * (`absorbedStreams`, with the stream's payment ids), its held-out payments are released and its
 * pending tracks fulfilled. The engine adds the absorbed payment ids to its stream map, so a
 * payment of the stream whose vendor key differs (pending names, payroll strings) still links.
 *
 * Absorb NEVER copies Plaid's numbers (average / last amount / dates): the update trigger has no
 * by-sync guard for an amount change, so copying them would re-materialize every period on every
 * sync. A later sync of an already absorbed stream writes nothing unless the stream gained
 * payments. Undo (`declined`) makes the next sync create a separate bill.
 *
 * @module domain/recurring/absorb
 */
import { AbsorbedStream } from "./convert_recurring.service";
import type { PlannerRecord, PlannerStream } from "./recurring_capture_planner.service";
/** A converted record that can absorb: v2 + manual + vendor key + account, shown, not merged. */
export declare function can_absorb(r: PlannerRecord): boolean;
/**
 * The converted record a stream is the same bill as, or null. Several (D44: two bills of one vendor
 * on one account): the one whose expected amount is closest to the stream's average, then the
 * smallest id — deterministic. PURE.
 */
export declare function find_absorber(stream: Pick<PlannerStream, "direction" | "account_id" | "average_amount">, stream_vendor_key: string, pool: PlannerRecord[]): PlannerRecord | null;
/** What an absorb writes to one converted record. */
export interface AbsorbWrite {
    record_id: string;
    direction: "outflow" | "inflow";
    /** The record's absorbed streams after the write (declined entries kept). */
    streams: AbsorbedStream[];
    /** The union of the absorbed streams' payments after the write (sorted). */
    txn_ids: string[];
    /** Plaid ids added by this write (the item sync re-assigns those stored transactions). */
    added_txn_ids: string[];
}
/**
 * The record's absorbed state after taking `stream` (or growing it). Returns null when nothing
 * would change (the common re-sync: 0 writes) or when the stream may not be absorbed (declined,
 * or the bounded list is full of streams still in the response). `in_response` = stream ids of
 * this sync's response (never evicted). PURE.
 */
export declare function plan_absorb(record: PlannerRecord, stream: PlannerStream, now_ms: number, in_response: ReadonlySet<string>, pending: AbsorbWrite | undefined): AbsorbWrite | "declined" | "full" | null;
/**
 * Undo an absorb (D3 undo): the stream is marked `declined` and its payments leave the record's
 * claimed set, so the next sync creates a separate bill for it. null = nothing to undo. PURE.
 */
export declare function decline_absorbed_stream(streams: AbsorbedStream[], stream_id: string, now_ms: number): {
    streams: AbsorbedStream[];
    txn_ids: string[];
} | null;
//# sourceMappingURL=absorb.service.d.ts.map