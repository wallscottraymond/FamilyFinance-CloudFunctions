/**
 * Stored shape + mappers of the Convert-To-Recurring Phase 2 fields on a bill / income doc.
 *
 * Shared by `outflow.repo` and `inflow.repo` so both write them identically. Every field is
 * server-only (the rules' update allowlist never lists them) and every one is written ONLY when
 * present — a conditional spread, never `?? null` — so a doc that doesn't carry them stays
 * byte-identical across syncs (no rewrite fan-out) and every full-document writer that rebuilds a
 * doc (`save_batch`) carries them through (`save_batch` is a full `set`).
 *
 * @module repositories/convert_doc_fields
 */
import type { AbsorbedStream, MergeLog } from "../domain/recurring/convert_recurring.service";
import type { RemovalMode } from "../domain/recurring/recurring_suppression.service";
export interface AbsorbedStreamDoc {
    streamId: string;
    state: "absorbed" | "declined";
    atMs: number;
    /** The Plaid payments of that stream the record claims (their union is `absorbedTxnIds`). */
    txnIds?: string[];
    vendorKey?: string;
}
export interface MergeLogDoc {
    into: string;
    atMs: number;
    priorIntervals: Array<{
        fromMs: number;
        toMs: number | null;
        mode: RemovalMode;
    }>;
    inheritedName: string | null;
    inheritedOverride: number | null;
    priorIsActive?: boolean;
}
/** The stored fields (all optional: absent = none). */
export interface ConvertDocFields {
    /** Vendor key payments are matched by (D1). */
    vendorKey?: string;
    /** The transaction this record was converted from. */
    convertedFromTxnId?: string;
    /** UTC day the record was created by the new path (ms). */
    convertedAtMs?: number;
    /** Plaid streams this record absorbed (D42), bounded. */
    absorbedStreams?: AbsorbedStreamDoc[];
    /** Plaid transaction ids this record claims durably besides its own stream (D42 / D2), bounded. */
    absorbedTxnIds?: string[];
    /** Past payments (Plaid transaction ids) a convert linked (D2 / D46) — D1 keeps them linked. */
    retroTxnIds?: string[];
    /** The splits of the converting transaction this record was converted from (a 2nd split converts on its own). */
    convertedFromSplitIds?: string[];
    /** Lease so only one resume of a died convert runs at a time (ms). */
    resumeLeaseMs?: number;
    /** When the convert's retro-link finished (ms). Absent = a convert that died: the next tap resumes it. */
    retroLinkedAtMs?: number;
    /** How many times the convert has run (the create is the first); a repeat failure gives up. */
    convertAttempts?: number;
    /** The convert's periods + follow-up pass finished (ms). Absent = a resume must redo them. */
    followUpsDoneAtMs?: number;
    /** Budgets the source split(s) belonged to when converted (the resume recomputes them). */
    convertedSourceBudgetIds?: string[];
    /** Set on a record that was merged into another (D7 / D22 / D41), so the merge can be undone. */
    mergeLog?: MergeLogDoc;
}
/** The fields of the entity that may seed a NEW doc (convert / Add Bill / Add Income). */
export interface ConvertEntityFields {
    vendor_key?: string;
    converted_from_txn_id?: string;
    converted_at_ms?: number;
    retro_txn_ids?: string[];
    converted_from_split_ids?: string[];
}
/**
 * The convert fields for a doc a full-document writer is about to `set`: an existing doc keeps
 * exactly what it has; a NEW doc takes the entity's. Conditional keys only.
 */
export declare function carried_convert_fields(existing: ConvertDocFields | null | undefined, entity: ConvertEntityFields): ConvertDocFields;
/** Convert-lifecycle markers: written ONLY by targeted `update()`s, never carried by a sync's `set`. */
export declare const CONVERT_LIFECYCLE_FIELDS: readonly ["resumeLeaseMs", "retroLinkedAtMs", "followUpsDoneAtMs", "convertAttempts"];
/**
 * How a sync's full-document write must treat a stored doc's lifecycle markers: when the stored doc
 * has any, they're removed from what is written and the write becomes a MERGE — so a marker the
 * sync read earlier can never overwrite a newer one. A doc without markers is written exactly as
 * before (byte-identical).
 */
export declare function without_lifecycle_markers(stored: object | null | undefined, doc: Record<string, unknown>): {
    data: Record<string, unknown>;
    merge: boolean;
};
/** Entity-side (snake_case) view of the stored fields. */
export interface ConvertEntityView {
    vendor_key: string | null;
    converted_from_txn_id: string | null;
    converted_at_ms: number | null;
    absorbed_streams: AbsorbedStream[];
    absorbed_txn_ids: string[];
    retro_txn_ids: string[];
    retro_linked_at_ms: number | null;
    converted_from_split_ids: string[];
    merge_log: MergeLog | null;
}
export declare function map_convert_fields_to_entity(doc: ConvertDocFields): ConvertEntityView;
export declare const absorbed_streams_to_doc: (xs: AbsorbedStream[]) => AbsorbedStreamDoc[];
export declare const merge_log_to_doc: (m: MergeLog) => MergeLogDoc;
//# sourceMappingURL=convert_doc_fields.d.ts.map