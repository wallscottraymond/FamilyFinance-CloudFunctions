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

import type {
  AbsorbedStream,
  MergeLog,
} from "../domain/recurring/convert_recurring.service";
import type { RemovalInterval, RemovalMode } from "../domain/recurring/recurring_suppression.service";

/* eslint-disable @typescript-eslint/naming-convention */
export interface AbsorbedStreamDoc {
  streamId: string;
  state: "absorbed" | "declined";
  atMs: number;
}

export interface MergeLogDoc {
  into: string;
  atMs: number;
  priorIntervals: Array<{ fromMs: number; toMs: number | null; mode: RemovalMode }>;
  inheritedName: string | null;
  inheritedOverride: number | null;
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
  /** Set on a record that was merged into another (D7 / D22 / D41), so the merge can be undone. */
  mergeLog?: MergeLogDoc;
}

/** The fields of the entity that may seed a NEW doc (convert / Add Bill / Add Income). */
export interface ConvertEntityFields {
  vendor_key?: string;
  converted_from_txn_id?: string;
  converted_at_ms?: number;
}

/**
 * The convert fields for a doc a full-document writer is about to `set`: an existing doc keeps
 * exactly what it has; a NEW doc takes the entity's. Conditional keys only.
 */
export function carried_convert_fields(
  existing: ConvertDocFields | null | undefined,
  entity: ConvertEntityFields
): ConvertDocFields {
  const v = existing?.vendorKey ?? (!existing ? entity.vendor_key : undefined);
  const f = existing?.convertedFromTxnId ?? (!existing ? entity.converted_from_txn_id : undefined);
  const a = existing?.convertedAtMs ?? (!existing ? entity.converted_at_ms : undefined);
  return {
    ...(v !== undefined ? { vendorKey: v } : {}),
    ...(f !== undefined ? { convertedFromTxnId: f } : {}),
    ...(a !== undefined ? { convertedAtMs: a } : {}),
    ...(existing?.absorbedStreams !== undefined ? { absorbedStreams: existing.absorbedStreams } : {}),
    ...(existing?.absorbedTxnIds !== undefined ? { absorbedTxnIds: existing.absorbedTxnIds } : {}),
    ...(existing?.mergeLog !== undefined ? { mergeLog: existing.mergeLog } : {}),
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/** Entity-side (snake_case) view of the stored fields. */
export interface ConvertEntityView {
  vendor_key: string | null;
  converted_from_txn_id: string | null;
  converted_at_ms: number | null;
  absorbed_streams: AbsorbedStream[];
  absorbed_txn_ids: string[];
  merge_log: MergeLog | null;
}

export function map_convert_fields_to_entity(doc: ConvertDocFields): ConvertEntityView {
  return {
    vendor_key: doc.vendorKey ?? null,
    converted_from_txn_id: doc.convertedFromTxnId ?? null,
    converted_at_ms: doc.convertedAtMs ?? null,
    absorbed_streams: (doc.absorbedStreams ?? []).map((s) => ({
      stream_id: s.streamId,
      state: s.state,
      at_ms: s.atMs,
    })),
    absorbed_txn_ids: doc.absorbedTxnIds ?? [],
    merge_log: doc.mergeLog
      ? {
        into: doc.mergeLog.into,
        at_ms: doc.mergeLog.atMs,
        prior_intervals: doc.mergeLog.priorIntervals.map(
          (i): RemovalInterval => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })
        ),
        inherited_name: doc.mergeLog.inheritedName,
        inherited_override: doc.mergeLog.inheritedOverride,
      }
      : null,
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export const absorbed_streams_to_doc = (xs: AbsorbedStream[]): AbsorbedStreamDoc[] =>
  xs.map((s) => ({ streamId: s.stream_id, state: s.state, atMs: s.at_ms }));

export const merge_log_to_doc = (m: MergeLog): MergeLogDoc => ({
  into: m.into,
  atMs: m.at_ms,
  priorIntervals: m.prior_intervals.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms, mode: i.mode })),
  inheritedName: m.inherited_name,
  inheritedOverride: m.inherited_override,
});
/* eslint-enable @typescript-eslint/naming-convention */
