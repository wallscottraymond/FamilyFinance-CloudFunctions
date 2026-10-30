"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.can_absorb = can_absorb;
exports.find_absorber = find_absorber;
exports.plan_absorb = plan_absorb;
exports.decline_absorbed_stream = decline_absorbed_stream;
const vendor_key_service_1 = require("../transactions/vendor_key.service");
const convert_recurring_service_1 = require("./convert_recurring.service");
/** Payments one absorbed stream may contribute (a Plaid stream rarely has more than ~120). */
const MAX_IDS_PER_STREAM = 120;
/** A converted record that can absorb: v2 + manual + vendor key + account, shown, not merged. */
function can_absorb(r) {
    return r.v2 && r.source === "manual" && !!r.vendor_key && !!r.account_id &&
        r.is_active && !r.is_hidden && !r.merged_into_id;
}
/**
 * The converted record a stream is the same bill as, or null. Several (D44: two bills of one vendor
 * on one account): the one whose expected amount is closest to the stream's average, then the
 * smallest id — deterministic. PURE.
 */
function find_absorber(stream, stream_vendor_key, pool) {
    const matches = pool.filter((r) => can_absorb(r) &&
        r.direction === stream.direction &&
        r.account_id === stream.account_id &&
        (r.vendor_key === stream_vendor_key ||
            (0, vendor_key_service_1.vendor_key)({ merchant_name: r.merchant_name, name: r.description }) === stream_vendor_key));
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => {
        var _a, _b;
        const da = Math.abs(Math.abs((_a = a.expected_amount_override) !== null && _a !== void 0 ? _a : a.average_amount) - stream.average_amount);
        const db = Math.abs(Math.abs((_b = b.expected_amount_override) !== null && _b !== void 0 ? _b : b.average_amount) - stream.average_amount);
        return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return matches[0];
}
const sorted_unique = (xs) => [...new Set(xs)].sort();
/** Unique ids in arrival order (Plaid lists a stream oldest → newest), so truncating keeps the NEWEST. */
const unique_ordered = (xs) => [...new Set(xs)];
/**
 * The record's absorbed state after taking `stream` (or growing it). Returns null when nothing
 * would change (the common re-sync: 0 writes) or when the stream may not be absorbed (declined,
 * or the bounded list is full of streams still in the response). `in_response` = stream ids of
 * this sync's response (never evicted). PURE.
 */
function plan_absorb(record, stream, now_ms, in_response, pending) {
    var _a, _b;
    const base_streams = (_b = (_a = pending === null || pending === void 0 ? void 0 : pending.streams) !== null && _a !== void 0 ? _a : record.absorbed_streams) !== null && _b !== void 0 ? _b : [];
    const existing = base_streams.find((s) => s.stream_id === stream.stream_id);
    if ((existing === null || existing === void 0 ? void 0 : existing.state) === "declined")
        return "declined";
    const ids = unique_ordered(stream.transaction_ids).slice(-MAX_IDS_PER_STREAM);
    if (existing) {
        const have = new Set(existing.txn_ids);
        const grown = ids.filter((id) => !have.has(id));
        if (grown.length === 0)
            return pending !== null && pending !== void 0 ? pending : null;
        return build(record, base_streams.map((s) => (s === existing ? Object.assign(Object.assign({}, s), { txn_ids: unique_ordered([...s.txn_ids, ...grown]).slice(-MAX_IDS_PER_STREAM) }) : s)), pending, grown);
    }
    let streams = [...base_streams];
    if (streams.length >= convert_recurring_service_1.MAX_ABSORBED_STREAMS) {
        // Prune only streams that have disappeared from Plaid's response (oldest first); never evict
        // one still in it.
        const gone = streams.filter((s) => s.state === "absorbed" && !in_response.has(s.stream_id)).sort((a, b) => a.at_ms - b.at_ms);
        if (gone.length === 0)
            return "full";
        streams = streams.filter((s) => s !== gone[0]);
    }
    const sv = (0, vendor_key_service_1.vendor_key)({ merchant_name: stream.merchant_name, name: stream.description });
    streams.push(Object.assign({ stream_id: stream.stream_id, state: "absorbed", at_ms: now_ms, txn_ids: ids }, (sv ? { vendor_key: sv } : {})));
    return build(record, streams, pending, ids);
}
function build(record, streams, pending, added) {
    var _a;
    const all = unique_ordered(streams.filter((s) => s.state === "absorbed").flatMap((s) => s.txn_ids)).slice(-convert_recurring_service_1.MAX_ABSORBED_TXN_IDS);
    return {
        record_id: record.id,
        direction: record.direction,
        streams,
        txn_ids: all,
        added_txn_ids: sorted_unique([...((_a = pending === null || pending === void 0 ? void 0 : pending.added_txn_ids) !== null && _a !== void 0 ? _a : []), ...added]),
    };
}
/**
 * Undo an absorb (D3 undo): the stream is marked `declined` and its payments leave the record's
 * claimed set, so the next sync creates a separate bill for it. null = nothing to undo. PURE.
 */
function decline_absorbed_stream(streams, stream_id, now_ms) {
    const hit = streams.find((s) => s.stream_id === stream_id && s.state === "absorbed");
    if (!hit)
        return null;
    const next = streams.map((s) => (s === hit ? Object.assign(Object.assign({}, s), { state: "declined", at_ms: now_ms, txn_ids: [] }) : s));
    const txn_ids = unique_ordered(next.filter((s) => s.state === "absorbed").flatMap((s) => s.txn_ids)).slice(-convert_recurring_service_1.MAX_ABSORBED_TXN_IDS);
    return { streams: next, txn_ids };
}
//# sourceMappingURL=absorb.service.js.map