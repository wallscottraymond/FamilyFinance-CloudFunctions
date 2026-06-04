/**
 * On Transaction Written (Trigger) — Transaction Assignment Engine entry
 *
 * Thin trigger: extracts the before/after snapshots and the user, then calls
 * exactly ONE orchestrator (`process_transaction_written`) which decides what
 * to enqueue. All branching/field-guard/budget-scope logic lives there.
 *
 * Loop prevention: the engine's own write changes assignment fields, which the
 * field-guard sees as relevant → one redundant job, which skip-if-unchanged
 * no-ops (no further write, no further trigger). Converges in one extra pass.
 *
 * @module entry/triggers/on_transaction_written
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { create_trigger_trace } from "../../observability";
import {
  process_transaction_written_orchestrator,
} from "../../orchestrators/transactions/process_transaction_written.orchestrator";

export const on_transaction_written = onDocumentWritten(
  {
    document: "transactions/{transactionId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
  },
  async (event) => {
    const transaction_id = event.params.transactionId;
    const before =
      (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null;
    const after =
      (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null;

    const user_id =
      (after?.userId as string | undefined) || (before?.userId as string | undefined);
    if (!user_id) {
      console.warn(
        `[on_transaction_written] no userId for transaction ${transaction_id}; skipping`
      );
      return;
    }

    // Idempotency: the trace's key (`trigger:${id}:${event.id}`) flows into the
    // orchestrator's per-event job deduplication keys, so trigger replays of the
    // SAME write collapse to one job.
    const trace = create_trigger_trace(transaction_id, event.id);

    await process_transaction_written_orchestrator(trace, {
      transaction_id,
      user_id,
      before,
      after,
      event_id: event.id,
    });
  }
);
