/**
 * Recurring-doc write-skip check (read/write-cost).
 *
 * `outflow_repo.save_batch` / `inflow_repo.save_batch` run on EVERY per-item recurring sync
 * (4 cycles/day) and used to `set()` every stream unconditionally with a fresh
 * `updatedAt`/`lastSyncedAt` — firing `on_recurring_updated` (derive-version bump +
 * reconcile enqueue + audit) for dozens of streams whose Plaid data hadn't changed, which
 * also invalidated every cached derived period.
 *
 * A write is skipped only when the document it would `set()` is IDENTICAL to the stored
 * one apart from the sync timestamps — same key set, same values (Timestamps by instant,
 * arrays in order). Anything else (including a stored field the new doc would drop) still
 * writes exactly as before. PURE.
 *
 * @module repositories/recurring_doc_equality
 */

/** Fields a sync re-stamps on every write; they don't make a doc "changed". */
const SYNC_TIMESTAMP_FIELDS = new Set(["updatedAt", "lastSyncedAt"]);

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number };
    if (typeof v.toMillis === "function") return { ts_ms: v.toMillis() };
    if (Array.isArray(value)) return value.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const n = normalize((value as Record<string, unknown>)[key]);
      if (n !== undefined) out[key] = n; // ignoreUndefinedProperties: undefined isn't stored
    }
    return out;
  }
  return value;
}

function comparable(doc: object): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SYNC_TIMESTAMP_FIELDS.has(key)) rest[key] = value;
  }
  return JSON.stringify(normalize(rest));
}

/** True when writing `next` over `stored` would change nothing but the sync timestamps. */
export function is_unchanged_recurring_doc(stored: object, next: object): boolean {
  return comparable(stored) === comparable(next);
}
