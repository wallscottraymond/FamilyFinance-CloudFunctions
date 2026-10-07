/**
 * Connections Orchestrators (D27, D28)
 *
 * get_sharing_overview: everything the Groups screen shows, in one call.
 * manage_connection: nickname / disconnect / block / report.
 *
 * @module orchestrators/sharing/connections
 */

import { OrchestratorContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  resolve_overview,
  resolve_connection_action,
} from "../../resolvers/sharing/sharing.resolver";
import {
  build_sharing_overview,
  SharingOverview,
} from "../../domain/sharing/sharing_overview.service";
import {
  apply_connection_action,
  build_block_without_connection,
} from "../../domain/sharing/connection.service";
import { build_report, cancel_requests } from "../../domain/sharing/request.service";
import {
  connection_repo,
  report_repo,
  request_repo,
} from "../../repositories/sharing";

/** The Groups-screen read model. Read-only: no idempotency, no writes. */
export async function get_sharing_overview_orchestrator(
  ctx: OrchestratorContext<Record<string, never>>
): Promise<SharingOverview> {
  const span = create_span(ctx, "orchestrator", "get_sharing_overview");
  log_operation_start(span, ctx.user_id);

  const deps = await resolve_overview(ctx, ctx.user_id);
  const overview = build_sharing_overview(
    ctx.user_id,
    deps.connections,
    deps.groups,
    deps.requests,
    deps.request_groups,
    Date.now()
  );

  log_operation_success(span, ctx.user_id);
  return overview;
}

export type ManageConnectionInput =
  | { action: "set_nickname"; other_user_id: string; nickname: string }
  | { action: "disconnect"; other_user_id: string }
  | { action: "block"; other_user_id: string }
  | { action: "report"; other_user_id: string; reason: string };

export interface ManageConnectionResult {
  success: boolean;
  errors?: string[];
}

/**
 * Applies a connection action. Report = block + a report record (D27). Blocking
 * also cancels pending requests between the two people. Someone who isn't
 * connected can still be blocked if they sent the caller a request.
 */
export async function manage_connection_orchestrator(
  ctx: OrchestratorContext<ManageConnectionInput>
): Promise<ManageConnectionResult> {
  const span = create_span(ctx, "orchestrator", "manage_connection");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();
  const other = ctx.input.other_user_id;
  if (other === ctx.user_id) return { success: false, errors: ["That's you"] };

  // 1. RESOLVER
  const deps = await resolve_connection_action(ctx, ctx.user_id, other);

  // 2. DOMAIN
  const blocks = ctx.input.action === "block" || ctx.input.action === "report";
  const sent_me_a_request = deps.pending_between.some((r) => r.from_user_id === other);
  const connection =
    !deps.connection && blocks && sent_me_a_request
      ? build_block_without_connection(ctx.user_id, other, now_ms)
      : deps.connection;
  const change = apply_connection_action(
    connection,
    ctx.user_id,
    ctx.input.action === "set_nickname"
      ? { action: "set_nickname", nickname: ctx.input.nickname }
      : ctx.input.action === "disconnect"
        ? { action: "disconnect" }
        : { action: "block" }
  );
  if (change.validation_errors?.length || !change.entity) {
    return { success: false, errors: change.validation_errors };
  }
  const report =
    ctx.input.action === "report"
      ? build_report(report_repo.new_id(), ctx.user_id, other, ctx.input.reason, now_ms)
      : null;
  if (report?.validation_errors?.length) {
    return { success: false, errors: report.validation_errors };
  }
  const cancelled = blocks ? cancel_requests(deps.pending_between, now_ms) : [];

  // 3. REPOSITORY
  const next = change.entity.connection;
  if (next) await connection_repo.save(ctx, next, now_ms);
  else await connection_repo.delete(ctx, connection!.id);
  await request_repo.save_many(ctx, cancelled);
  if (report?.entity) await report_repo.save(ctx, report.entity);

  log_operation_success(span, ctx.user_id);
  return { success: true };
}
