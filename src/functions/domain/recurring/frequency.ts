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

export type CanonicalFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMIMONTHLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUALLY"
  | "UNKNOWN";

/**
 * Map any stored/Plaid frequency spelling to a canonical token. PURE.
 */
export function normalize_frequency(frequency: string | null | undefined): CanonicalFrequency {
  // Uppercase + strip underscores collapses "SEMI_MONTHLY"→"SEMIMONTHLY", "monthly"→"MONTHLY".
  const raw = (frequency ?? "").toUpperCase().replace(/_/g, "");
  switch (raw) {
  case "WEEKLY":
    return "WEEKLY";
  case "BIWEEKLY":
  case "FORTNIGHTLY":
    return "BIWEEKLY";
  case "SEMIMONTHLY":
    return "SEMIMONTHLY";
  case "MONTHLY":
    return "MONTHLY";
  case "QUARTERLY":
    return "QUARTERLY";
  case "ANNUALLY":
  case "ANNUAL":
  case "YEARLY":
    return "ANNUALLY";
  default:
    return "UNKNOWN";
  }
}

/**
 * Plaid reports some kept streams with frequency UNKNOWN (Code-Health-Review P1-M5). Such a stream
 * is never stored as monthly (the fan-out bug above): an EXISTING record keeps the cadence it
 * already has; a new one is stored as "unknown" (generation steps it by a year). Every other
 * stream is returned unchanged (same object). PURE.
 *
 * @param stored_frequency - the record's currently stored frequency by id (undefined = new)
 */
export function keep_known_frequency<T extends { id: string; frequency: string }>(
  entities: T[],
  stored_frequency: (id: string) => string | null | undefined
): T[] {
  return entities.map((e) => {
    if (normalize_frequency(e.frequency) !== "UNKNOWN") return e;
    const stored = stored_frequency(e.id);
    return stored && normalize_frequency(stored) !== "UNKNOWN" ? { ...e, frequency: stored } : e;
  });
}
