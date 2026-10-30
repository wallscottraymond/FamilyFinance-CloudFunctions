"use strict";
/**
 * Same bill? (Convert-To-Recurring D7 / X9) — does a NEW Plaid stream look like the replacement of
 * a bill that STOPPED (a plan, amount or account change: Sunbit's new plan, Hulu moving cards)?
 *
 * REPLACEMENT ONLY. A match needs, all of:
 *   - same direction, same vendor key, a different stream;
 *   - the old one has STOPPED: not active (stale / Plaid-inactive) — but never an account-removal
 *     soft delete (its account is gone) — or a v2 bill Plaid turned off, or a stream this very
 *     sync reports inactive / no longer returns;
 *   - the new one STARTED around or after the old one's last payment (first ≥ last − 10 days), and
 *     not long after it stopped (first ≤ last + 120 days).
 * Two streams that are BOTH still active are never the same bill (Shellpoint is paid twice a
 * month: two real bills).
 *
 * PURE: no IO.
 *
 * @module domain/recurring/same_bill
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAME_BILL_GAP_MS = exports.SAME_BILL_OVERLAP_MS = void 0;
exports.has_stopped = has_stopped;
exports.find_replaced_record = find_replaced_record;
const vendor_key_service_1 = require("../transactions/vendor_key.service");
const DAY = 24 * 60 * 60 * 1000;
/** The new stream may start this long before the old one's last payment (overlap at the switch). */
exports.SAME_BILL_OVERLAP_MS = 10 * DAY;
/** …and at most this long after it (a stream that stopped long ago isn't being replaced). */
exports.SAME_BILL_GAP_MS = 120 * DAY;
const record_vendor = (r) => (0, vendor_key_service_1.vendor_key)({ merchant_name: r.merchant_name, name: r.description });
/** Has this record stopped (and not because its account was removed)? PURE. */
function has_stopped(r, c) {
    if (r.merged_into_id)
        return false;
    if (c.stopped_in_sync.has(r.id))
        return true;
    if (r.v2 && r.plaid_is_active === false)
        return true;
    if (!r.is_active)
        return c.active_account_ids.has(r.account_id); // removed account → not stopped
    return false;
}
/**
 * The stopped record a new stream replaces, or null. When several qualify, the one that stopped
 * most recently wins (deterministic: then by id). PURE.
 */
function find_replaced_record(stream, vendor, candidates, c) {
    const matches = candidates.filter((r) => r.direction === stream.direction &&
        r.id !== stream.stream_id &&
        record_vendor(r) === vendor &&
        has_stopped(r, c) &&
        stream.first_date_ms >= r.last_date_ms - exports.SAME_BILL_OVERLAP_MS &&
        stream.first_date_ms <= r.last_date_ms + exports.SAME_BILL_GAP_MS);
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => b.last_date_ms - a.last_date_ms || (a.id < b.id ? -1 : 1));
    return matches[0];
}
//# sourceMappingURL=same_bill.service.js.map