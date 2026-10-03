/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?kind=left|summary|bills&cadence=monthly&lookahead=7&have=<version>
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
export declare const widget_snapshot: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=widget_snapshot.entry.d.ts.map