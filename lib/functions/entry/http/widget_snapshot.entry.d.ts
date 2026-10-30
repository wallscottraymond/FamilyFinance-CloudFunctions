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
import { z } from "zod";
declare const query_schema: z.ZodObject<{
    kind: z.ZodDefault<z.ZodEnum<{
        summary: "summary";
        bills: "bills";
        recent: "recent";
        left: "left";
        budget_txns: "budget_txns";
    }>>;
    budget: z.ZodOptional<z.ZodString>;
    group: z.ZodOptional<z.ZodString>;
    cadence: z.ZodDefault<z.ZodEnum<{
        weekly: "weekly";
        monthly: "monthly";
        bi_monthly: "bi_monthly";
    }>>;
    lookahead: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    have: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
type WidgetQuery = z.infer<typeof query_schema> & {
    lookahead: number;
};
/** The widget's query, or null when invalid. The look-ahead only means something to Bills due
 *  soon (7 / 14 / 30 days); every other kind ignores it, so it never fails their request
 *  (Recent transactions sends 0: a strict check rejected every one of its requests). */
export declare function parse_widget_query(query: unknown): WidgetQuery | null;
export declare const widget_snapshot: import("firebase-functions/v2/https").HttpsFunction;
export {};
//# sourceMappingURL=widget_snapshot.entry.d.ts.map