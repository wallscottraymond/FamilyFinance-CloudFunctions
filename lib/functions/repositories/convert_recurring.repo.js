"use strict";
/**
 * Convert-To-Recurring repository: the ATOMIC create of a converted bill / income together with its
 * source split's pin — one Firestore transaction (review item 4). It reads the source transaction,
 * refuses when a split of it already pays a live record (the double tap, D44: only a transaction
 * already linked to a live bill is refused), then creates the record (stamped with the creator's
 * run id so the create / update triggers skip it) and pins the split(s) (the transaction write is
 * stamped `assignRunId`, so `on_transaction_written` skips it too). The creator then generates the
 * periods and runs ONE follow-up pass.
 *
 * @module repositories/convert_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.convert_recurring_repo = exports.RESUME_LEASE_MS = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const recurring_suppression_service_1 = require("../domain/recurring/recurring_suppression.service");
const convert_recurring_service_1 = require("../domain/recurring/convert_recurring.service");
const audit_1 = require("../audit");
const outflow_repo_1 = require("./outflow.repo");
const inflow_repo_1 = require("./inflow.repo");
/** At least the callable timeout (300 s) with margin: a resume never overlaps a slow original. */
exports.RESUME_LEASE_MS = 330000;
const live = (d) => {
    var _a;
    return !!d && d.isActive !== false && d.isHidden !== true && !d.mergedIntoId &&
        // a bill the user removed / ended right now isn't claiming anything (a paused one still is)
        !(0, recurring_suppression_service_1.is_removed_now)(((_a = d.removalIntervals) !== null && _a !== void 0 ? _a : [])
            .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })), Date.now());
};
exports.convert_recurring_repo = {
    async create_with_source_pin(ctx, args) {
        const db = (0, firestore_1.getFirestore)();
        const txn_ref = db.collection("transactions").doc(args.source_txn_doc_id);
        const coll = args.direction === "outflow" ? "outflows" : "inflows";
        const built = args.direction === "outflow"
            ? outflow_repo_1.outflow_repo.build_new_doc(args.entity, args.run_id)
            : inflow_repo_1.inflow_repo.build_new_doc(args.entity, args.run_id);
        const link_field = args.direction === "outflow" ? "outflowId" : "inflowId";
        const result = await db.runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f, _g;
            const snap = await tx.get(txn_ref);
            if (!snap.exists)
                throw new types_1.NotFoundError("transaction", args.source_txn_doc_id);
            const before = snap.data();
            const owner = (_a = before.ownerId) !== null && _a !== void 0 ? _a : before.userId;
            if (owner !== args.user_id)
                throw new types_1.PermissionDeniedError("convert_transaction_to_recurring", args.source_txn_doc_id);
            const splits = (_b = before.splits) !== null && _b !== void 0 ? _b : [];
            const targets = splits.filter((s) => args.source_split_ids.includes(s.splitId));
            if (targets.length === 0)
                throw new types_1.NotFoundError("transaction_split", args.source_split_ids.join(","));
            // A split already paying a LIVE record of this kind → refuse (read inside the transaction).
            const linked = [...new Set(targets.map((s) => s[link_field]).filter((x) => !!x))];
            for (const id of linked) {
                const other = await tx.get(db.collection(coll).doc(id));
                const d = other.exists ? other.data() : undefined;
                if (live(d)) {
                    const same_source = (d === null || d === void 0 ? void 0 : d.convertedFromTxnId) === args.source_txn_doc_id &&
                        ((_c = d === null || d === void 0 ? void 0 : d.convertedFromSplitIds) !== null && _c !== void 0 ? _c : []).some((x) => args.source_split_ids.includes(x));
                    if (same_source) {
                        const lease = (_d = d === null || d === void 0 ? void 0 : d.resumeLeaseMs) !== null && _d !== void 0 ? _d : 0;
                        return { status: "already_converted", existing_id: id, in_progress: lease > Date.now() && (d === null || d === void 0 ? void 0 : d.retroLinkedAtMs) === undefined };
                    }
                    return {
                        status: "already_tracked",
                        existing_id: id,
                        existing_name: String((_g = (_f = (_e = d === null || d === void 0 ? void 0 : d.userCustomName) !== null && _e !== void 0 ? _e : d === null || d === void 0 ? void 0 : d.merchantName) !== null && _f !== void 0 ? _f : d === null || d === void 0 ? void 0 : d.description) !== null && _g !== void 0 ? _g : ""),
                    };
                }
            }
            const now = firestore_1.Timestamp.now();
            const new_splits = splits.map((s) => args.source_split_ids.includes(s.splitId) ? (0, convert_recurring_service_1.apply_source_pin)(s, args.direction, args.entity.id) : s);
            const ids = (field) => Array.from(new Set(new_splits.map((s) => s[field]).filter((x) => !!x)));
            /* eslint-disable @typescript-eslint/naming-convention */
            const update = {
                splits: new_splits,
                splitOutflowIds: ids("outflowId"),
                splitInflowIds: ids("inflowId"),
                // Stamped: `on_transaction_written` skips it; the creator runs the one follow-up pass.
                assignRunId: args.run_id,
                lastWriteSource: "assignment",
                updatedAt: now,
                updatedBy: args.user_id,
            };
            /* eslint-enable @typescript-eslint/naming-convention */
            // The convert is in progress: a tap during it (or until the lease runs out) resumes nothing.
            const source_budgets = [...new Set(targets.flatMap((s) => { var _a; return [s.budgetId, ...(((_a = s.budgetIds) !== null && _a !== void 0 ? _a : []))]; })
                    .filter((b) => !!b && b !== "unassigned"))];
            tx.create(built.ref, Object.assign(Object.assign(Object.assign({}, built.data), { resumeLeaseMs: Date.now() + exports.RESUME_LEASE_MS, convertAttempts: 1 }), (source_budgets.length ? { convertedSourceBudgetIds: source_budgets } : {})));
            tx.update(txn_ref, update);
            return {
                status: "created",
                id: args.entity.id,
                record: built.data,
                source_before: before,
                source_after: Object.assign(Object.assign({}, before), update),
            };
        });
        if (result.status === "created") {
            (0, audit_1.record_audit_entry_async)({
                user_id: args.user_id,
                action: "create",
                entity_type: args.direction === "outflow" ? "recurring_outflow" : "recurring_inflow",
                entity_id: args.entity.id,
                before: null,
                after: result.record,
                trace_id: ctx.trace_id,
                metadata: { source: "api", context: { operation: "convert_transaction_to_recurring" } },
            });
        }
        return result;
    },
};
//# sourceMappingURL=convert_recurring.repo.js.map