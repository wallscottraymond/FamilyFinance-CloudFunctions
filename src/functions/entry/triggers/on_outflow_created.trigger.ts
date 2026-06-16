/**
 * Outflow Created Trigger
 *
 * Firestore trigger that fires when a new outflow document is created.
 * Calls the generate_outflow_periods_orchestrator to create period instances.
 *
 * This replaces the legacy onOutflowCreated trigger with an architecture-compliant version
 * that follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * Memory: 512MiB, Timeout: 60s
 *
 * @module entry/triggers/on_outflow_created
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { create_trigger_trace } from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import {
  generate_outflow_periods_orchestrator,
  GenerateOutflowPeriodsContext,
} from "../../orchestrators/outflows";

/**
 * Firestore trigger on outflows/{outflowId}
 *
 * Automatically generates outflow_period documents when a new outflow is created.
 * Uses idempotency to prevent duplicate processing.
 */
export const on_outflow_created = onDocumentCreated(
  {
    document: "outflows/{outflowId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const outflow_id = event.params.outflowId;
    const outflow_data = event.data?.data();

    // ===== DIAGNOSTIC LOGGING START =====
    console.log(`[on_outflow_created] ===== TRIGGER FIRED =====`);
    console.log(`[on_outflow_created] outflow_id: ${outflow_id}`);
    console.log(`[on_outflow_created] event.id: ${event.id}`);
    console.log(
      `[on_outflow_created] outflow_data keys: ${outflow_data ? Object.keys(outflow_data).join(", ") : "NO DATA"}`
    );
    if (outflow_data) {
      console.log(
        `[on_outflow_created] DIAGNOSTIC - Key fields: ` +
          `ownerId=${outflow_data.ownerId}, ` +
          `userId=${outflow_data.userId}, ` +
          `isActive=${outflow_data.isActive}, ` +
          `description=${outflow_data.description}, ` +
          `frequency=${outflow_data.frequency}, ` +
          `averageAmount=${outflow_data.averageAmount}`
      );
    }
    // ===== DIAGNOSTIC LOGGING END =====

    // Guard: No data
    if (!outflow_data) {
      console.error(
        `[on_outflow_created] No data found in outflow document: ${outflow_id}`
      );
      return;
    }

    // Guard: Inactive outflow
    if (outflow_data.isActive === false) {
      console.log(
        `[on_outflow_created] Skipping inactive outflow: ${outflow_id}. isActive value: ${outflow_data.isActive}`
      );
      return;
    }

    // Extract user ID (handle both naming conventions)
    const user_id = outflow_data.ownerId ?? outflow_data.userId;

    if (!user_id) {
      console.error(
        `[on_outflow_created] Missing user ID in outflow document: ${outflow_id}. ` +
          `Available fields: ownerId=${outflow_data.ownerId}, userId=${outflow_data.userId}`
      );
      return;
    }

    console.log(
      `[on_outflow_created] Trigger fired for outflow ${outflow_id}, user ${user_id}`
    );

    // COEXISTENCE CHECK: Skip if periods already exist (prevents duplicate processing)
    // This handles trigger retries and any race conditions
    const db = getFirestore();
    const existing_periods = await db
      .collection("outflow_periods")
      .where("outflowId", "==", outflow_id)
      .limit(1)
      .select() // Only need to check existence, not data
      .get();

    if (!existing_periods.empty) {
      console.log(
        `[on_outflow_created] Periods already exist for outflow ${outflow_id}. Skipping to prevent duplicates.`
      );
      return;
    }

    // Create trace context with idempotency key
    // Use event.id to ensure trigger replays don't create duplicates
    const trace = create_trigger_trace(outflow_id, event.id);
    const idempotency_key = trace.idempotency_key;

    console.log(
      `[on_outflow_created] Creating periods with trace_id=${trace.trace_id}, idempotency_key=${idempotency_key}`
    );

    // Build orchestrator context
    const ctx: GenerateOutflowPeriodsContext = {
      ...trace,
      input: {
        outflow_id,
        outflow_data: outflow_data as Record<string, unknown>,
        user_id,
      },
      idempotency_key,
    };

    console.log(
      `[on_outflow_created] Calling generate_outflow_periods_orchestrator with input: ` +
        `outflow_id=${outflow_id}, user_id=${user_id}`
    );

    try {
      // Call exactly ONE orchestrator
      const result = await generate_outflow_periods_orchestrator(ctx);

      console.log(
        `[on_outflow_created] Orchestrator returned: success=${result.success}, ` +
          `periods_created=${result.periods_created}, errors=${JSON.stringify(result.errors || [])}`
      );

      if (result.success) {
        console.log(
          `[on_outflow_created] Successfully generated ${result.periods_created} periods for outflow ${outflow_id}`
        );

        // Now that periods exist, (1) re-assign the outflow's transactions so
        // their splits carry `outflowId` (budget recurring-exclusion needs this —
        // they were synced before this outflow/its periods existed), and
        // (2) reconcile the periods' "paid" status from the transaction membership.
        // Both enqueued AFTER period generation (Recurring-Period-Reconciliation).
        const transaction_ids = outflow_data.transactionIds as string[] | undefined;
        if (transaction_ids && transaction_ids.length > 0) {
          await create_job(
            "assign_recurring_transactions",
            {
              recurring_id: outflow_id,
              recurring_type: "outflow",
              user_id,
              trace_id: trace.trace_id,
            },
            { trace_id: trace.trace_id }
          );
          await create_job(
            "reconcile_recurring_period",
            {
              recurring_id: outflow_id,
              recurring_type: "outflow",
              user_id,
              trace_id: trace.trace_id,
            },
            { trace_id: trace.trace_id }
          );
        }
      } else {
        console.error(
          `[on_outflow_created] Failed to generate periods for outflow ${outflow_id}:`,
          result.errors
        );
      }
    } catch (error) {
      console.error(
        `[on_outflow_created] Error generating periods for outflow ${outflow_id}:`,
        error
      );
      console.error(
        `[on_outflow_created] Error stack:`,
        error instanceof Error ? error.stack : "No stack available"
      );

      // Don't rethrow - Cloud Functions will retry the trigger
      // The idempotency check will prevent duplicate processing
    }
  }
);
