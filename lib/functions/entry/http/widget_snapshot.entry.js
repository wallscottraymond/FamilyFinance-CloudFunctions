"use strict";
/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?kind=left|summary|bills|budget_txns|recent&cadence=monthly&lookahead=7
 *       &budget=<id, budget_txns only>&group=<group id, optional>&have=<version>
 *   Authorization: Bearer <widget token>
 * → 200 { unchanged: true, version }      (widget already current; ~2 reads)
 * → 200 { version, data }                 (fresh widget data, schema v2)
 * → 200 { version, data: null }           (no current source period)
 * → 401 { error }                         (unknown / revoked token)
 * → 403 { error: "not_member" }            (group widget, caller no longer in that group)
 *
 * The token is read-only and scoped to widget data. Never logged.
 *
 * @module entry/http/widget_snapshot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.widget_snapshot = void 0;
exports.parse_widget_query = parse_widget_query;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const widget_snapshot_orchestrator_1 = require("../../orchestrators/widgets/widget_snapshot.orchestrator");
const query_schema = zod_1.z.object({
    kind: zod_1.z.enum(["left", "summary", "bills", "budget_txns", "recent"]).default("left"),
    budget: zod_1.z.string().min(1).max(128).optional(),
    group: zod_1.z.string().trim().min(1).max(128).optional(),
    cadence: zod_1.z.enum(["monthly", "weekly", "bi_monthly"]).default("monthly"),
    lookahead: zod_1.z.coerce.number().int().optional(),
    have: zod_1.z.coerce.number().int().nonnegative().optional(),
});
const BILLS_LOOKAHEADS = [7, 14, 30];
/** The widget's query, or null when invalid. The look-ahead only means something to Bills due
 *  soon (7 / 14 / 30 days); every other kind ignores it, so it never fails their request
 *  (Recent transactions sends 0: a strict check rejected every one of its requests). */
function parse_widget_query(query) {
    var _a;
    const parsed = query_schema.safeParse(query);
    if (!parsed.success)
        return null;
    const q = parsed.data;
    if (q.kind === "budget_txns" && !q.budget)
        return null;
    const lookahead = (_a = q.lookahead) !== null && _a !== void 0 ? _a : 14;
    if (q.kind === "bills" && !BILLS_LOOKAHEADS.includes(lookahead))
        return null;
    return Object.assign(Object.assign({}, q), { lookahead: q.kind === "bills" ? lookahead : 14 });
}
exports.widget_snapshot = (0, https_1.onRequest)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20, cors: false }, async (req, res) => {
    var _a, _b, _c, _d;
    if (req.method !== "GET") {
        res.status(405).json({ error: "method_not_allowed" });
        return;
    }
    const auth = (_a = req.get("authorization")) !== null && _a !== void 0 ? _a : "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (token.length < 32) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const query = parse_widget_query(req.query);
    if (!query) {
        res.status(400).json({ error: "invalid_query" });
        return;
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const outcome = await (0, widget_snapshot_orchestrator_1.widget_snapshot_orchestrator)(ctx, {
            token,
            kind: query.kind,
            budget_id: (_b = query.budget) !== null && _b !== void 0 ? _b : null,
            group_id: (_c = query.group) !== null && _c !== void 0 ? _c : null,
            cadence: query.cadence,
            lookahead_days: query.lookahead,
            have_version: (_d = query.have) !== null && _d !== void 0 ? _d : null,
            now_ms: Date.now(),
        });
        res.set("Cache-Control", "no-store");
        switch (outcome.status) {
            case "unauthorized":
                res.status(401).json({ error: "unauthorized" });
                return;
            case "not_member":
                res.status(403).json({ error: "not_member" });
                return;
            case "unchanged":
                res.status(200).json({ unchanged: true, version: outcome.version });
                return;
            case "no_period":
                res.status(200).json({ version: outcome.version, data: null });
                return;
            case "data":
                res.status(200).json({ version: outcome.version, data: outcome.data });
                return;
        }
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] widget_snapshot failed:`, error);
        res.status(500).json({ error: "internal", trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=widget_snapshot.entry.js.map