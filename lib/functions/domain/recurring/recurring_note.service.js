"use strict";
/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing; Budget-And-Bill-Detail-Pages,
 * 2026-11-13). PURE.
 *
 * - `pick_definition_fields`: the definition fields the detail screens show, and nothing else
 *   (a group member sees what the owner's detail page shows, not the whole doc).
 * - `to_client`: Firestore Timestamps → `{ __ts: ms }` so the app can rebuild them.
 * - `normalize_note`: trimmed, at most NOTE_MAX characters ("" = clear).
 * - `period_belongs_to`: a period is only reachable through its own bill / income.
 *
 * @module domain/recurring/recurring_note
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTE_MAX = void 0;
exports.pick_definition_fields = pick_definition_fields;
exports.period_recurring_id = period_recurring_id;
exports.period_belongs_to = period_belongs_to;
exports.to_client = to_client;
exports.normalize_note = normalize_note;
exports.NOTE_MAX = 2000;
/** What Bill detail / Income detail read from the definition. */
const DEFINITION_FIELDS = {
    outflow: [
        "description", "merchantName", "expenseType", "frequency", "userCustomName",
        "expectedAmountOverride", "averageAmount",
        "internalDetailedCategory", "plaidDetailedCategory",
    ],
    inflow: [
        "description", "payerName", "frequency", "userCustomName",
        "expectedAmountOverride", "averageAmount", "incomeType",
        "hourlyConfig", "commissionConfig", "bonusConfig", "variableConfig",
        "incomeParts", "forecastSettings", "occurrenceParts", "incomeNote",
    ],
};
const LINK_FIELD = { outflow: "outflowId", inflow: "inflowId" };
function pick_definition_fields(kind, raw) {
    const out = {};
    for (const f of DEFINITION_FIELDS[kind])
        if (raw[f] !== undefined)
            out[f] = raw[f];
    return out;
}
/** The bill / income a period belongs to (null when it has none). */
function period_recurring_id(kind, period) {
    const v = period[LINK_FIELD[kind]];
    return typeof v === "string" && v ? v : null;
}
function period_belongs_to(kind, period, recurring_id) {
    return period_recurring_id(kind, period) === recurring_id;
}
function is_timestamp(v) {
    return !!v && typeof v === "object" &&
        typeof v.toMillis === "function";
}
/** Deep copy with every Timestamp as `{ __ts: ms }` (the callable wire can't carry them). */
function to_client(value) {
    if (is_timestamp(value))
        return { __ts: value.toMillis() };
    if (Array.isArray(value))
        return value.map(to_client);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = to_client(v);
        return out;
    }
    return value;
}
function normalize_note(text) {
    const note = text.trim();
    if (note.length > exports.NOTE_MAX) {
        return { validation_errors: [`A note can be up to ${exports.NOTE_MAX} characters`] };
    }
    return { entity: note };
}
//# sourceMappingURL=recurring_note.service.js.map