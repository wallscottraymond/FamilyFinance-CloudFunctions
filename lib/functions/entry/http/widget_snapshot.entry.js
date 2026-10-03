"use strict";
/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?cadence=monthly&have=<data version>
 *   Authorization: Bearer <widget token>
 * → 200 { unchanged: true, version }               (widget already current; ~2 reads)
 * → 200 { version, snapshot }                      (fresh snapshot, schema v1)
 * → 200 { version, snapshot: null }                (no current source period)
 * → 401 { error }                                  (unknown / revoked token)
 *
 * The token is read-only and scoped to this snapshot. Never logged.
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
    cadence: zod_1.z.enum(["monthly", "weekly", "bi_monthly"]).default("monthly"),
    have: zod_1.z.coerce.number().int().nonnegative().optional(),
});
exports.widget_snapshot = (0, https_1.onRequest)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20, cors: false }, async (req, res) => {
    var _a, _b;
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
    if (!parsed.success) {
        res.status(400).json({ error: "invalid_query" });
        return;
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const outcome = await (0, widget_snapshot_orchestrator_1.widget_snapshot_orchestrator)(ctx, {
            token,
            cadence: parsed.data.cadence,
            have_version: (_b = parsed.data.have) !== null && _b !== void 0 ? _b : null,
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
                res.status(200).json({ version: outcome.version, snapshot: null });
                return;
            case "snapshot":
                res.status(200).json({ version: outcome.version, snapshot: outcome.snapshot });
                return;
        }
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] widget_snapshot failed:`, error);
        res.status(500).json({ error: "internal", trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=widget_snapshot.entry.js.map