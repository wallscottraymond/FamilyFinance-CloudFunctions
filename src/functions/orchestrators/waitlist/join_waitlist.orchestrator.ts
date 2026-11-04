/**
 * Join-waitlist orchestrator (Website-Waitlist)
 *
 * Resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 * The doc id comes from the email, so a double submit can't create two entries.
 *
 * @module orchestrators/waitlist/join_waitlist
 */

import { TraceContext } from "../../types";
import { create_span, log_operation_start, log_operation_success } from "../../observability";
import { waitlist_repo } from "../../repositories/waitlist.repo";
import { resolve_join_waitlist_dependencies } from "../../resolvers/waitlist/waitlist.resolver";
import { entry_id, ip_limit_id, plan_join, utc_day } from "../../domain/waitlist/waitlist.service";
import { JoinWaitlistInput, JoinWaitlistStatus } from "../../types/waitlist.types";

export async function join_waitlist_orchestrator(
  ctx: TraceContext,
  input: JoinWaitlistInput,
  ip: string,
  now_ms: number = Date.now()
): Promise<JoinWaitlistStatus> {
  const span = create_span(ctx, "orchestrator", "join_waitlist");
  log_operation_start(span, "public");

  // The honeypot was filled: answer like a success so the bot learns nothing, and store nothing.
  if (input.company) {
    log_operation_success(span, "public");
    return "ignored";
  }

  resolve_join_waitlist_dependencies(ctx);

  const planned = await waitlist_repo.join_in_transaction(
    ctx,
    entry_id(input.email),
    ip_limit_id(ip, utc_day(now_ms)),
    (state) => plan_join(input, state, now_ms)
  );
  log_operation_success(span, "public");
  return planned.status;
}
