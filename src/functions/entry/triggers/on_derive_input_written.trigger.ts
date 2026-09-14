/**
 * On Derive-Input Written (Triggers) — derived-period cache invalidation
 *
 * `derive_period` reads 7 sources; five are already covered by their own triggers
 * (transactions, outflows, inflows, budget_periods). This file closes the remaining
 * OWNER-SCOPED gaps — `budgets` and `goals` — by bumping the user's derive-input version
 * so their cached periods recompute on the next read ([[Firestore-Read-Cost-Reduction]]).
 *
 * These are thin invalidation-only triggers (no orchestrator, no cascade): extract the
 * owner, fire-and-forget a version bump, done. `bump_derive_version` writes only to
 * `user_data_versions` (no trigger there), so there is no loop.
 *
 * NOT covered here: `source_periods` is a GLOBAL, non-owner-scoped calendar that changes
 * rarely (period generation extends the horizon) — a per-user version can't target it, so
 * it relies on the cache's TTL backstop (minutes) to pick up new period definitions.
 *
 * @module entry/triggers/on_derive_input_written
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { bump_derive_version } from "../../repositories/derive_version.repo";

/** Owner of a derive-input doc, across the app's naming conventions. */
function owner_of(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string | undefined {
  const d = after ?? before ?? {};
  return (d.userId ?? d.ownerId ?? d.createdBy) as string | undefined;
}

const TRIGGER_OPTS = {
  region: "us-central1",
  memory: "256MiB" as const,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  timeoutSeconds: 30,
};

export const on_budget_written = onDocumentWritten(
  { ...TRIGGER_OPTS, document: "budgets/{budgetId}" },
  async (event) => {
    const owner = owner_of(
      (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null,
      (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null
    );
    if (owner) void bump_derive_version(owner).catch(() => {});
  }
);

export const on_goal_written = onDocumentWritten(
  { ...TRIGGER_OPTS, document: "goals/{goalId}" },
  async (event) => {
    const owner = owner_of(
      (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null,
      (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null
    );
    if (owner) void bump_derive_version(owner).catch(() => {});
  }
);
