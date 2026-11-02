/**
 * Canonical recurring-frequency normalization (shared by bills + income).
 *
 * Plaid and the app store a MIX of spellings for the same cadence:
 *   "MONTHLY" / "monthly", "WEEKLY" / "weekly", "biweekly", "semimonthly",
 *   "SEMI_MONTHLY" (legacy underscore), "yearly" / "annually".
 * Each cycle/stepping switch used to compare against ONE spelling and silently fall
 * through to a MONTHLY default on any mismatch — which made a **yearly** bill (and a
 * **semimonthly** inflow) generate one occurrence PER MONTH, so it appeared in every
 * period. This is the single place that maps every spelling to ONE canonical token.
 *
 * An unrecognized value returns `"UNKNOWN"` — callers MUST NOT treat that as monthly
 * (that is the fan-out bug). Generation steps `UNKNOWN` by a year so an unknown-cadence
 * item yields at most ~one occurrence per window instead of exploding across every period.
 *
 * PURE: no IO, deterministic.
 *
 * @module domain/recurring/frequency
 */
export type CanonicalFrequency = "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY" | "UNKNOWN";
/**
 * Map any stored/Plaid frequency spelling to a canonical token. PURE.
 */
export declare function normalize_frequency(frequency: string | null | undefined): CanonicalFrequency;
/**
 * Plaid reports some kept streams with frequency UNKNOWN (Code-Health-Review P1-M5). Such a stream
 * is never stored as monthly (the fan-out bug above): an EXISTING record keeps the cadence it
 * already has; a new one is stored as "unknown" (generation steps it by a year). Every other
 * stream is returned unchanged (same object). PURE.
 *
 * @param stored_frequency - the record's currently stored frequency by id (undefined = new)
 */
export declare function keep_known_frequency<T extends {
    id: string;
    frequency: string;
}>(entities: T[], stored_frequency: (id: string) => string | null | undefined): T[];
//# sourceMappingURL=frequency.d.ts.map