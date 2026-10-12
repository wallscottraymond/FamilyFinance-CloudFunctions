/**
 * audit_transaction_assignments (admin) — Transaction-Integrity-Review 3-A, on demand.
 *
 * "Stored == derived" audit for one user (or every user): a DRY RUN of the bounded re-assign
 * engine (reassign_user). The engine and the period page call the same category function and
 * budget matcher, so what the dry run would change is exactly where a stored split disagrees with
 * what the app derives. Read-only: the report (counts, budget moves, samples) lands in
 * `_reassign_runs/{run_id}`; nothing is written to any transaction. Replaces the deleted
 * `auditTransactionAssignments` HTTP endpoint (unauthenticated, with a `?fix=true` write path).
 *
 * @module entry/callable/audit_transaction_assignments
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { generate_id } from "../../observability";
import { enqueue_audits } from "../../orchestrators/transactions/reassign_fanout.orchestrator";

const input_schema = z.object({
  user_id: z.string().min(1).optional(),
  all_users: z.boolean().optional(),
});

export const audit_transaction_assignments = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    if (request.auth.token?.admin !== true) throw new HttpsError("permission-denied", "Admins only");
    const parsed = input_schema.safeParse(request.data ?? {});
    if (!parsed.success || (!parsed.data.user_id && !parsed.data.all_users)) {
      throw new HttpsError("invalid-argument", "Pass user_id or all_users: true");
    }
    const trace_id = generate_id();
    const queued = await enqueue_audits(
      { trace_id, span_id: trace_id },
      parsed.data.all_users ? "all" : [parsed.data.user_id as string]
    );
    return { success: true, queued, trace_id };
  }
);
