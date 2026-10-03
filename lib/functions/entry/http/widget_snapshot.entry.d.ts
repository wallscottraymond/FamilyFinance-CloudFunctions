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
export declare const widget_snapshot: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=widget_snapshot.entry.d.ts.map