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
  /** The Plaid payments of that stream the record claims (their union is `absorbedTxnIds`). */
  txnIds?: string[];
  vendorKey?: string;
}

export interface MergeLogDoc {
  into: string;
  atMs: number;
  priorIntervals: Array<{ fromMs: number; toMs: number | null; mode: RemovalMode }>;
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
    ...(existing?.retroTxnIds !== undefined ? { retroTxnIds: existing.retroTxnIds } : (!existing && entity.retro_txn_ids?.length ? { retroTxnIds: entity.retro_txn_ids } : {})),
    ...(existing?.convertedFromSplitIds !== undefined ? { convertedFromSplitIds: existing.convertedFromSplitIds } : (!existing && entity.converted_from_split_ids?.length ? { convertedFromSplitIds: entity.converted_from_split_ids } : {})),
    ...(existing?.resumeLeaseMs !== undefined ? { resumeLeaseMs: existing.resumeLeaseMs } : {}),
    ...(existing?.retroLinkedAtMs !== undefined ? { retroLinkedAtMs: existing.retroLinkedAtMs } : {}),
    ...(existing?.convertAttempts !== undefined ? { convertAttempts: existing.convertAttempts } : {}),
    ...(existing?.followUpsDoneAtMs !== undefined ? { followUpsDoneAtMs: existing.followUpsDoneAtMs } : {}),
    ...(existing?.convertedSourceBudgetIds !== undefined ? { convertedSourceBudgetIds: existing.convertedSourceBudgetIds } : {}),
    ...(existing?.mergeLog !== undefined ? { mergeLog: existing.mergeLog } : {}),
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/** Convert-lifecycle markers: written ONLY by targeted `update()`s, never carried by a sync's `set`. */
export const CONVERT_LIFECYCLE_FIELDS = ["resumeLeaseMs", "retroLinkedAtMs", "followUpsDoneAtMs", "convertAttempts"] as const;

/**
 * How a sync's full-document write must treat a stored doc's lifecycle markers: when the stored doc
 * has any, they're removed from what is written and the write becomes a MERGE — so a marker the
 * sync read earlier can never overwrite a newer one. A doc without markers is written exactly as
 * before (byte-identical).
 */
export function without_lifecycle_markers(
  stored: object | null | undefined,
  doc: Record<string, unknown>
): { data: Record<string, unknown>; merge: boolean } {
  const has = !!stored && CONVERT_LIFECYCLE_FIELDS.some((f) => (stored as Record<string, unknown>)[f] !== undefined);
  if (!has) return { data: doc, merge: false };
  const data = { ...doc };
  for (const f of CONVERT_LIFECYCLE_FIELDS) delete data[f];
  return { data, merge: true };
}

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

export function map_convert_fields_to_entity(doc: ConvertDocFields): ConvertEntityView {
  return {
    vendor_key: doc.vendorKey ?? null,
    converted_from_txn_id: doc.convertedFromTxnId ?? null,
    converted_at_ms: doc.convertedAtMs ?? null,
    absorbed_streams: (doc.absorbedStreams ?? []).map((s) => ({
      stream_id: s.streamId,
      state: s.state,
      at_ms: s.atMs,
      txn_ids: s.txnIds ?? [],
      ...(s.vendorKey ? { vendor_key: s.vendorKey } : {}),
    })),
    absorbed_txn_ids: doc.absorbedTxnIds ?? [],
    retro_txn_ids: doc.retroTxnIds ?? [],
    retro_linked_at_ms: doc.retroLinkedAtMs ?? null,
    converted_from_split_ids: doc.convertedFromSplitIds ?? [],
    merge_log: doc.mergeLog
      ? {
        into: doc.mergeLog.into,
        at_ms: doc.mergeLog.atMs,
        prior_intervals: doc.mergeLog.priorIntervals.map(
          (i): RemovalInterval => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })
        ),
        inherited_name: doc.mergeLog.inheritedName,
        inherited_override: doc.mergeLog.inheritedOverride,
        ...(doc.mergeLog.priorIsActive !== undefined ? { prior_is_active: doc.mergeLog.priorIsActive } : {}),
      }
      : null,
  };
}

/* eslint-disable @typescript-eslint/naming-convention */
export const absorbed_streams_to_doc = (xs: AbsorbedStream[]): AbsorbedStreamDoc[] =>
  xs.map((s) => ({ streamId: s.stream_id, state: s.state, atMs: s.at_ms, txnIds: s.txn_ids, ...(s.vendor_key ? { vendorKey: s.vendor_key } : {}) }));

export const merge_log_to_doc = (m: MergeLog): MergeLogDoc => ({
  into: m.into,
  atMs: m.at_ms,
  priorIntervals: m.prior_intervals.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms, mode: i.mode })),
  inheritedName: m.inherited_name,
  inheritedOverride: m.inherited_override,
  ...(m.prior_is_active !== undefined ? { priorIsActive: m.prior_is_active } : {}),
});
/* eslint-enable @typescript-eslint/naming-convention */
