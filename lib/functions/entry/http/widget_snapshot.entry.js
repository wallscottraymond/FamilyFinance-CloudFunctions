"use strict";
/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?kind=left|summary|bills|budget_txns&cadence=monthly&lookahead=7
 *       &budget=<id, budget_txns only>&have=<version>
 *   Authorization: Bearer <widget token>
 * → 200 { unchanged: true, version }      (widget already current; ~2 reads)
 * → 200 { version, data }                 (fresh widget data, schema v2)
 * → 200 { version, data: null }           (no current source period)
 * → 401 { error }                         (unknown / revoked token)
 *
 * The token is read-only and scoped to widget data. Never logged.
 *
 * @module entry/http/widget_snapshot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.widget_snapshot = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const widget_snapshot_orchestrator_1 = require("../../orchestrators/widgets/widget_snapshot.orchestrator");
const query_schema = zod_1.z.object({
    kind: zod_1.z.enum(["left", "summary", "bills", "budget_txns"]).default("left"),
    budget: zod_1.z.string().min(1).max(128).optional(),
    cadence: zod_1.z.enum(["monthly", "weekly", "bi_monthly"]).default("monthly"),
    lookahead: zod_1.z.coerce.number().int().refine((n) => [7, 14, 30].includes(n)).default(14),
    have: zod_1.z.coerce.number().int().nonnegative().optional(),
});
exports.widget_snapshot = (0, https_1.onRequest)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20, cors: false }, async (req, res) => {
    var _a, _b, _c;
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
    const parsed = query_schema.safeParse(req.query);
    if (!parsed.success || (parsed.data.kind === "budget_txns" && !parsed.data.budget)) {
        res.status(400).json({ error: "invalid_query" });
        return;
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const outcome = await (0, widget_snapshot_orchestrator_1.widget_snapshot_orchestrator)(ctx, {
            token,
            kind: parsed.data.kind,
            budget_id: (_b = parsed.data.budget) !== null && _b !== void 0 ? _b : null,
            cadence: parsed.data.cadence,
            lookahead_days: parsed.data.lookahead,
            have_version: (_c = parsed.data.have) !== null && _c !== void 0 ? _c : null,
            now_ms: Date.now(),
        });
        res.set("Cache-Control", "no-store");
        switch (outcome.status) {
            case "unauthorized":
                res.status(401).json({ error: "unauthorized" });
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