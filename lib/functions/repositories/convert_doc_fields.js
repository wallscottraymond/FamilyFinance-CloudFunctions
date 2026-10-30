"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge_log_to_doc = exports.absorbed_streams_to_doc = exports.CONVERT_LIFECYCLE_FIELDS = void 0;
exports.carried_convert_fields = carried_convert_fields;
exports.without_lifecycle_markers = without_lifecycle_markers;
exports.map_convert_fields_to_entity = map_convert_fields_to_entity;
/**
 * The convert fields for a doc a full-document writer is about to `set`: an existing doc keeps
 * exactly what it has; a NEW doc takes the entity's. Conditional keys only.
 */
function carried_convert_fields(existing, entity) {
    var _a, _b, _c, _d, _e;
    const v = (_a = existing === null || existing === void 0 ? void 0 : existing.vendorKey) !== null && _a !== void 0 ? _a : (!existing ? entity.vendor_key : undefined);
    const f = (_b = existing === null || existing === void 0 ? void 0 : existing.convertedFromTxnId) !== null && _b !== void 0 ? _b : (!existing ? entity.converted_from_txn_id : undefined);
    const a = (_c = existing === null || existing === void 0 ? void 0 : existing.convertedAtMs) !== null && _c !== void 0 ? _c : (!existing ? entity.converted_at_ms : undefined);
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (v !== undefined ? { vendorKey: v } : {})), (f !== undefined ? { convertedFromTxnId: f } : {})), (a !== undefined ? { convertedAtMs: a } : {})), ((existing === null || existing === void 0 ? void 0 : existing.absorbedStreams) !== undefined ? { absorbedStreams: existing.absorbedStreams } : {})), ((existing === null || existing === void 0 ? void 0 : existing.absorbedTxnIds) !== undefined ? { absorbedTxnIds: existing.absorbedTxnIds } : {})), ((existing === null || existing === void 0 ? void 0 : existing.retroTxnIds) !== undefined ? { retroTxnIds: existing.retroTxnIds } : (!existing && ((_d = entity.retro_txn_ids) === null || _d === void 0 ? void 0 : _d.length) ? { retroTxnIds: entity.retro_txn_ids } : {}))), ((existing === null || existing === void 0 ? void 0 : existing.convertedFromSplitIds) !== undefined ? { convertedFromSplitIds: existing.convertedFromSplitIds } : (!existing && ((_e = entity.converted_from_split_ids) === null || _e === void 0 ? void 0 : _e.length) ? { convertedFromSplitIds: entity.converted_from_split_ids } : {}))), ((existing === null || existing === void 0 ? void 0 : existing.resumeLeaseMs) !== undefined ? { resumeLeaseMs: existing.resumeLeaseMs } : {})), ((existing === null || existing === void 0 ? void 0 : existing.retroLinkedAtMs) !== undefined ? { retroLinkedAtMs: existing.retroLinkedAtMs } : {})), ((existing === null || existing === void 0 ? void 0 : existing.convertAttempts) !== undefined ? { convertAttempts: existing.convertAttempts } : {})), ((existing === null || existing === void 0 ? void 0 : existing.followUpsDoneAtMs) !== undefined ? { followUpsDoneAtMs: existing.followUpsDoneAtMs } : {})), ((existing === null || existing === void 0 ? void 0 : existing.convertedSourceBudgetIds) !== undefined ? { convertedSourceBudgetIds: existing.convertedSourceBudgetIds } : {})), ((existing === null || existing === void 0 ? void 0 : existing.mergeLog) !== undefined ? { mergeLog: existing.mergeLog } : {}));
}
/* eslint-enable @typescript-eslint/naming-convention */
/** Convert-lifecycle markers: written ONLY by targeted `update()`s, never carried by a sync's `set`. */
exports.CONVERT_LIFECYCLE_FIELDS = ["resumeLeaseMs", "retroLinkedAtMs", "followUpsDoneAtMs", "convertAttempts"];
/**
 * How a sync's full-document write must treat a stored doc's lifecycle markers: when the stored doc
 * has any, they're removed from what is written and the write becomes a MERGE — so a marker the
 * sync read earlier can never overwrite a newer one. A doc without markers is written exactly as
 * before (byte-identical).
 */
function without_lifecycle_markers(stored, doc) {
    const has = !!stored && exports.CONVERT_LIFECYCLE_FIELDS.some((f) => stored[f] !== undefined);
    if (!has)
        return { data: doc, merge: false };
    const data = Object.assign({}, doc);
    for (const f of exports.CONVERT_LIFECYCLE_FIELDS)
        delete data[f];
    return { data, merge: true };
}
function map_convert_fields_to_entity(doc) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return {
        vendor_key: (_a = doc.vendorKey) !== null && _a !== void 0 ? _a : null,
        converted_from_txn_id: (_b = doc.convertedFromTxnId) !== null && _b !== void 0 ? _b : null,
        converted_at_ms: (_c = doc.convertedAtMs) !== null && _c !== void 0 ? _c : null,
        absorbed_streams: ((_d = doc.absorbedStreams) !== null && _d !== void 0 ? _d : []).map((s) => {
            var _a;
            return (Object.assign({ stream_id: s.streamId, state: s.state, at_ms: s.atMs, txn_ids: (_a = s.txnIds) !== null && _a !== void 0 ? _a : [] }, (s.vendorKey ? { vendor_key: s.vendorKey } : {})));
        }),
        absorbed_txn_ids: (_e = doc.absorbedTxnIds) !== null && _e !== void 0 ? _e : [],
        retro_txn_ids: (_f = doc.retroTxnIds) !== null && _f !== void 0 ? _f : [],
        retro_linked_at_ms: (_g = doc.retroLinkedAtMs) !== null && _g !== void 0 ? _g : null,
        converted_from_split_ids: (_h = doc.convertedFromSplitIds) !== null && _h !== void 0 ? _h : [],
        merge_log: doc.mergeLog
            ? Object.assign({ into: doc.mergeLog.into, at_ms: doc.mergeLog.atMs, prior_intervals: doc.mergeLog.priorIntervals.map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })), inherited_name: doc.mergeLog.inheritedName, inherited_override: doc.mergeLog.inheritedOverride }, (doc.mergeLog.priorIsActive !== undefined ? { prior_is_active: doc.mergeLog.priorIsActive } : {})) : null,
    };
}
/* eslint-disable @typescript-eslint/naming-convention */
const absorbed_streams_to_doc = (xs) => xs.map((s) => (Object.assign({ streamId: s.stream_id, state: s.state, atMs: s.at_ms, txnIds: s.txn_ids }, (s.vendor_key ? { vendorKey: s.vendor_key } : {}))));
exports.absorbed_streams_to_doc = absorbed_streams_to_doc;
const merge_log_to_doc = (m) => (Object.assign({ into: m.into, atMs: m.at_ms, priorIntervals: m.prior_intervals.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms, mode: i.mode })), inheritedName: m.inherited_name, inheritedOverride: m.inherited_override }, (m.prior_is_active !== undefined ? { priorIsActive: m.prior_is_active } : {})));
exports.merge_log_to_doc = merge_log_to_doc;
/* eslint-enable @typescript-eslint/naming-convention */
//# sourceMappingURL=convert_doc_fields.js.map