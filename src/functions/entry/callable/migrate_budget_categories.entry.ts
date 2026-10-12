/**
 * migrate_budget_categories (admin) — canon A2 one-time migration, dry run first.
 *
 *   { dry_run: true }                          → report in `_migration_reports/{run_id}`
 *   { dry_run: false, reviewed_run_id: "…" }   → apply exactly the reviewed plan
 *
 * Requires the `admin` custom claim. Returns counts + the run id.
 *
 * @module entry/callable/migrate_budget_categories
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { generate_id } from "../../observability";
import { migrate_budget_categories_orchestrator } from "../../orchestrators/budgets/migrate_budget_categories.orchestrator";

const input_schema = z.object({
  dry_run: z.boolean(),
  reviewed_run_id: z.string().min(1).optional(),
});

export const migrate_budget_categories = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    if (request.auth.token?.admin !== true) {
      throw new HttpsError("permission-denied", "Admins only");
    }
    const parsed = input_schema.safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const trace_id = generate_id();
    try {
      return await migrate_budget_categories_orchestrator(
        { trace_id, span_id: trace_id },
        parsed.data
      );
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Migration failed",
        { trace_id }
      );
    }
  }
);
