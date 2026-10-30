"use strict";
/**
 * Classify Internal Transfers (orchestrator step)
 *
 * Plaid recurring detection recreates internal account-transfer streams on every
 * sync (they're subscribed) and adds more when new cards are linked. We can't tell
 * an internal transfer from an external ACH bill at transform time — it needs
 * matched-pair detection across accounts. So AFTER each recurring sync we classify
 * the user's recurring outflow/inflow records and durably HIDE the internal ones
 * (kept: external ACH bills + credit-card payments). `isHidden` is preserved by
 * `save_batch`, so the hide survives future re-syncs of the same stream.
 *
 * Self-correcting: also UN-hides transfer records that are no longer internal.
 *
 * READ COST: it runs after every per-item recurring sync (4 cycles/day × N items), but its
 * answer only changes when the recurring records change. So it fingerprints its inputs
 * (each active record's id, category, stream transaction ids and hidden flag) and SKIPS the
 * 180-day transaction scan when the fingerprint matches the last full run AND that run is
 * < 24h old. The 24h backstop covers the one input the fingerprint can't see: a transfer's
 * matched counterpart posting later on another account (previously picked up ≤6h later).
 *
 * @module orchestrators/plaid/classify_internal_transfers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASSIFY_TRANSFERS_JOB = void 0;
exports.classify_internal_transfers_orchestrator = classify_internal_transfers_orchestrator;
exports.classify_transfers_around = classify_transfers_around;
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
const repositories_1 = require("../../repositories");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const capture_rules_1 = require("../../domain/recurring/capture_rules");
const transfer_hiding_service_1 = require("../../domain/recurring/transfer_hiding.service");
const on_read_matching_1 = require("../../resolvers/shared/on_read_matching");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const transfer_roles_resolver_1 = require("../../resolvers/transactions/transfer_roles.resolver");
const observability_1 = require("../../observability");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
const sync_follow_ups_1 = require("./sync_follow_ups");
const job_queue_1 = require("../../infrastructure/job_queue");
const sharing_1 = require("../../repositories/sharing");
const transfer_classification_state_repo_1 = require("../../repositories/transfer_classification_state.repo");
const crypto_1 = require("crypto");
const detect_possible_recurring_orchestrator_1 = require("../recurring/detect_possible_recurring.orchestrator");
/** Window of transactions loaded for matched-pair detection. */
const PAIRING_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
/** Pairing slack each side — THE shared one (the period page pairs the same). */
const ROLE_PAIRING_BUFFER_MS = edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
/** A forced run (transfers just synced) re-decides roles only this far back. */
const FORCED_ROLE_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
/** Max age of a skipped (unchanged-fingerprint) result before a full re-run is forced. */
const FULL_RECLASSIFY_MS = 24 * 60 * 60 * 1000;
/** Bump when the classification logic changes, to invalidate every stored fingerprint. */
const CLASSIFIER_VERSION = 2; // v2: also stores transfer roles (3d)
/**
 * Stable fingerprint of the classifier's record inputs. `hidden_of` lets the caller hash the
 * POST-classification hidden flags, so an unchanged next run matches. PURE.
 */
function fingerprint(outflows, inflows, hidden_of) {
    const rows = [
        ...outflows.map((r) => ["o", r, hidden_of("o", r)]),
        ...inflows.map((r) => ["i", r, hidden_of("i", r)]),
    ]
        .map(([kind, r, hidden]) => {
        var _a;
        return [
            kind,
            r.id,
            r.plaid_detailed_category,
            hidden ? 1 : 0,
            [...((_a = r.transaction_ids) !== null && _a !== void 0 ? _a : [])].sort().join(","),
            // Only v2 rows carry a marker, so every existing user's fingerprint is unchanged (no
            // forced re-scan on deploy; CLASSIFIER_VERSION untouched — X21).
            ...(r.capture_rules_version === capture_rules_1.CAPTURE_RULES_VERSION ? ["v2"] : []),
        ].join("|");
    })
        .sort();
    return (0, crypto_1.createHash)("sha1")
        .update(`v${CLASSIFIER_VERSION}\n${rows.join("\n")}`)
        .digest("hex");
}
// Old records: a recurring record is HIDDEN when it is a transfer category, is an internal
// (matched-pair) transfer, and is NOT a credit-card payment (`should_hide_v1`). v2 records: the
// majority rule with hysteresis + card-payment inflows always hidden (`should_hide_v2`, X7).
async function classify_internal_transfers_orchestrator(ctx, user_id, now_ms, 
/** `force`: transfer transactions were just written — a new matched pair can exist even though
 *  the recurring records (all the fingerprint covers) are unchanged. */
opts) {
    var _a;
    // 1. Load recurring records (+ the last run's state) — cheap; decides whether the
    //    expensive transaction scan is needed at all.
    const [outflows, inflows, state] = await Promise.all([
        repositories_1.outflow_repo.get_by_user_id(ctx, user_id),
        repositories_1.inflow_repo.get_by_user_id(ctx, user_id),
        (0, transfer_classification_state_repo_1.get_transfer_classification_state)(user_id),
    ]);
    const current_fp = fingerprint(outflows, inflows, (_k, r) => r.is_hidden);
    if (!(opts === null || opts === void 0 ? void 0 : opts.force) &&
        state &&
        state.fingerprint === current_fp &&
        now_ms - state.classified_at_ms < FULL_RECLASSIFY_MS) {
        return { hidden_outflows: 0, hidden_inflows: 0, skipped: true };
    }
    // +5 days of pairing slack so a pair straddling the window edge keeps its partner.
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, now_ms - PAIRING_WINDOW_MS - ROLE_PAIRING_BUFFER_MS, now_ms);
    // 2. Matched-pair internal-transfer detection over the window's transfers.
    const { internal_ids, internal_plaid_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(txns, await (0, category_catalog_resolver_1.load_category_catalog)(ctx));
    // 3. Split each collection into hide / unhide (self-correcting).
    // The Plaid ids loaded in the window: a v2 stream's majority is counted over these only (X7).
    const window_plaid_ids = new Set(txns.map((t) => t.data.transactionId).filter((x) => !!x));
    const partition = (kind, records) => {
        const hide = [];
        const unhide = [];
        for (const r of records) {
            const target = (0, transfer_hiding_service_1.target_hidden)({
                kind,
                plaid_detailed_category: r.plaid_detailed_category,
                transaction_ids: r.transaction_ids,
                is_hidden: r.is_hidden,
                v2: r.capture_rules_version === capture_rules_1.CAPTURE_RULES_VERSION,
            }, window_plaid_ids, internal_plaid_ids);
            if (target && !r.is_hidden)
                hide.push(r.id);
            else if (!target && r.is_hidden)
                unhide.push(r.id);
        }
        return { hide, unhide };
    };
    const out = partition("o", outflows);
    const inf = partition("i", inflows);
    await Promise.all([
        repositories_1.outflow_repo.mark_hidden(ctx, out.hide, true, user_id),
        repositories_1.outflow_repo.mark_hidden(ctx, out.unhide, false, user_id),
        repositories_1.inflow_repo.mark_hidden(ctx, inf.hide, true, user_id),
        repositories_1.inflow_repo.mark_hidden(ctx, inf.unhide, false, user_id),
    ]);
    // Propagate the hidden flag onto the period docs so period-doc readers (e.g. the
    // assign-to-bill picker) exclude internal transfers using the SAME durable signal —
    // not a separate heuristic. Generation already copies `is_hidden`; this keeps the
    // already-materialized periods in sync when classification flips.
    await Promise.all([
        outflow_period_repo_1.outflow_period_repo.set_hidden_by_outflow_ids(ctx, out.hide, true),
        outflow_period_repo_1.outflow_period_repo.set_hidden_by_outflow_ids(ctx, out.unhide, false),
        inflow_period_repo_1.inflow_period_repo.set_hidden_by_inflow_ids(ctx, inf.hide, true),
        inflow_period_repo_1.inflow_period_repo.set_hidden_by_inflow_ids(ctx, inf.unhide, false),
    ]);
    // 3b. Transfer roles on the user's own transfer transactions (3d) — decided exactly as the
    //     period page decides them. A FORCED run (new transfers just synced) re-decides only the
    //     recent window; the 24h backstop re-decides the full window. Only changed roles are
    //     written (stamped), and a transaction that STOPPED being a transfer (re-categorized) gets
    //     "none" so the app never trusts a stale role. The changed transactions are re-assigned
    //     here in ONE batch with one follow-up (no trigger chain, no transfer re-scan).
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const role_from_ms = now_ms - ((opts === null || opts === void 0 ? void 0 : opts.force) ? FORCED_ROLE_WINDOW_MS : PAIRING_WINDOW_MS);
    const roles = await (0, transfer_roles_resolver_1.resolve_transfer_roles)(ctx, user_id, role_from_ms, now_ms, catalog, txns);
    const changed = new Map();
    for (const t of txns) {
        const ms = t.data.transactionDate.toMillis();
        if (ms < role_from_ms || t.data.userId !== user_id)
            continue;
        const next = (_a = roles.get(t.id)) !== null && _a !== void 0 ? _a : (t.data.transferRole ? "none" : undefined);
        if (next !== undefined && next !== t.data.transferRole)
            changed.set(t.id, next);
    }
    if (changed.size > 0) {
        const run_id = (0, observability_1.generate_id)();
        await transaction_repo_1.transaction_repo.set_transfer_roles(ctx, changed, run_id);
        const written = [];
        await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
            user_id,
            transaction_ids: [...changed.keys()],
            run_id: (0, observability_1.generate_id)(), // its own stamp: a new id on this write is what the trigger skips
            collect_into: written,
        });
        if (written.length) {
            await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, user_id, Object.assign(Object.assign({}, (0, sync_follow_ups_1.follow_ups_from_written)(written)), { transfers_changed: false }));
        }
        // A pair across the view boundary also changes the OTHER members' edge legs: refresh theirs
        // (coalesced, delayed — one per member per burst).
        if ([...changed.values()].some((r) => r === "edge_in" || r === "edge_out")) {
            await enqueue_partner_classification(ctx, user_id);
        }
    }
    // 4. Remember what we classified (hashing the flags as they are NOW, after the writes),
    //    so the next run with unchanged inputs skips. Only reached if every write succeeded.
    const hidden_after = (kind, r) => {
        const p = kind === "o" ? out : inf;
        if (p.hide.includes(r.id))
            return true;
        if (p.unhide.includes(r.id))
            return false;
        return r.is_hidden;
    };
    await (0, transfer_classification_state_repo_1.set_transfer_classification_state)(user_id, {
        fingerprint: fingerprint(outflows, inflows, hidden_after),
        classified_at_ms: now_ms,
    });
    // 5. The possible-bill detector rides this scan (Convert-To-Recurring X12: no extra transaction
    //    read) — flag-on users only, at most once per UTC day, non-fatal.
    try {
        await (0, detect_possible_recurring_orchestrator_1.run_detector_on_scan)(ctx, user_id, now_ms, {
            txns,
            internal_txn_ids: internal_ids,
            records: [
                ...outflows.map((o) => { var _a; return ({ kind: "outflow", transaction_ids: (_a = o.transaction_ids) !== null && _a !== void 0 ? _a : [], merchant_name: o.merchant_name, description: o.description }); }),
                ...inflows.map((i) => { var _a; return ({ kind: "inflow", transaction_ids: (_a = i.transaction_ids) !== null && _a !== void 0 ? _a : [], merchant_name: i.payer_name, description: i.description }); }),
            ],
        });
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] possible-bill detector failed (non-fatal):`, error);
    }
    return { hidden_outflows: out.hide.length, hidden_inflows: inf.hide.length, skipped: false };
}
/**
 * Re-decide transfer roles only AROUND one transaction (a user moved it into / out of a transfer
 * category). A role depends only on legs within the pairing slack, so the transactions within
 * [date − slack, date + slack] are re-decided with the SAME pairing as the full run (which reads
 * ~6 months); stream hiding is left to the daily full pass. Changed roles are written, re-assigned
 * in one batch with one follow-up, and partners refreshed — exactly as the full run does.
 */
async function classify_transfers_around(ctx, user_id, txn_date_ms) {
    var _a;
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const from_ms = txn_date_ms - ROLE_PAIRING_BUFFER_MS;
    const to_ms = txn_date_ms + ROLE_PAIRING_BUFFER_MS;
    // The user's own transactions over the window ± slack (the roles resolver pairs over exactly
    // this pool for a [from, to] window).
    const own = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, from_ms - ROLE_PAIRING_BUFFER_MS, to_ms + ROLE_PAIRING_BUFFER_MS);
    const roles = await (0, transfer_roles_resolver_1.resolve_transfer_roles)(ctx, user_id, from_ms, to_ms, catalog, own);
    const changed = new Map();
    for (const t of own) {
        const ms = t.data.transactionDate.toMillis();
        if (ms < from_ms || ms > to_ms || t.data.userId !== user_id)
            continue;
        const next = (_a = roles.get(t.id)) !== null && _a !== void 0 ? _a : (t.data.transferRole ? "none" : undefined);
        if (next !== undefined && next !== t.data.transferRole)
            changed.set(t.id, next);
    }
    if (changed.size === 0)
        return;
    await transaction_repo_1.transaction_repo.set_transfer_roles(ctx, changed, (0, observability_1.generate_id)());
    const written = [];
    await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
        user_id,
        transaction_ids: [...changed.keys()],
        run_id: (0, observability_1.generate_id)(),
        collect_into: written,
    });
    if (written.length) {
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, user_id, Object.assign(Object.assign({}, (0, sync_follow_ups_1.follow_ups_from_written)(written)), { transfers_changed: false }));
    }
    if ([...changed.values()].some((r) => r === "edge_in" || r === "edge_out")) {
        await enqueue_partner_classification(ctx, user_id);
    }
}
/** Job type: re-classify one user's transfers (forced) — a partner's pair changed. */
exports.CLASSIFY_TRANSFERS_JOB = "classify_transfers";
async function enqueue_partner_classification(ctx, user_id) {
    const groups = await sharing_1.group_repo.get_for_user(ctx, user_id).catch(() => []);
    const partners = new Set(groups.flatMap((g) => g.member_ids).filter((m) => m !== user_id));
    for (const partner of partners) {
        await (0, job_queue_1.coalesce_job)(exports.CLASSIFY_TRANSFERS_JOB, { deduplication_key: `classify:${partner}`, user_id: partner }, { delay_seconds: 60, trace_id: ctx.trace_id }).catch(() => { });
    }
}
//# sourceMappingURL=classify_internal_transfers.orchestrator.js.map