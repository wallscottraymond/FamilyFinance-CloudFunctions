/**
 * Join Waitlist Entry Point (Website-Waitlist)
 *
 * POST /api/waitlist on budg.io (Firebase Hosting rewrite, so same-origin and no CORS).
 *   { email, source?: "hero" | "footer", company?: honeypot }
 * → 200 { ok: true }              (joined, already on the list, or honeypot: all look the same)
 * → 400 { error: "invalid_email" }
 * → 405 { error: "method_not_allowed" }
 * → 429 { error: "rate_limited" }
 *
 * Public and unauthenticated by design: the site has no sign-in. Emails and addresses are never
 * logged.
 *
 * @module entry/http/join_waitlist
 */
export declare const join_waitlist: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=join_waitlist.entry.d.ts.map