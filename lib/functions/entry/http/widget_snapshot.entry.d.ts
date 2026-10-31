/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?kind=left|summary|bills|budget_txns|recent&cadence=monthly&lookahead=7
 *       &budget=<id, budget_txns only>&group=<group id, optional>&have=<version>
 *       &day=<the widget's LOCAL calendar day, YYYY-MM-DD, optional>
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
    day: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type WidgetQuery = z.infer<typeof query_schema> & {
    lookahead: number;
};
/** The widget's query, or null when invalid. The look-ahead only means something to Bills due
 *  soon (7 / 14 / 30 days); every other kind ignores it, so it never fails their request
 *  (Recent transactions sends 0: a strict check rejected every one of its requests). */
export declare function parse_widget_query(query: unknown): WidgetQuery | null;
/**
 * The instant the widget's period / bills window / daily version are chosen at: noon UTC of the
 * caller's LOCAL calendar day (`day`), so its UTC day index IS that local day (batch 6 verify #3:
 * on a US evening the server's UTC clock is already tomorrow, which flipped Left to Spend and
 * Period Summary to the next period on a period's last evening). Accepted only within a day of
 * the server's UTC day (every real time zone is); otherwise — or absent (older widget builds) —
 * the server clock, as before.
 */
export declare function widget_day_ms(day: string | undefined, now_ms: number): number;
export declare const widget_snapshot: import("firebase-functions/v2/https").HttpsFunction;
export {};
//# sourceMappingURL=widget_snapshot.entry.d.ts.map