/**
 * Connect Orchestrators (D24, D29)
 *
 * get_my_connect_code: shows (or issues) the caller's code.
 * enter_connect_code: the caller typed someone's code; connects when both have.
 *
 * @module orchestrators/sharing/connect
 */

import { randomInt } from "crypto";
import { OrchestratorContext } from "../../types";
import { PersonView } from "../../types/sharing.types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  resolve_my_code,
  resolve_code_taken,
  resolve_code_entry,
} from "../../resolvers/sharing/sharing.resolver";
import {
  build_code,
  build_connect_code,
  normalize_entered_code,
  evaluate_code_entry,
  apply_failure,
  should_issue_new_code,
  CodeEntryOutcome,
  CODE_LENGTH,
  CODE_ALPHABET,
  MAX_CONNECTIONS,
} from "../../domain/sharing/connect_code.service";
import { build_connection } from "../../domain/sharing/connection.service";
import { person_view } from "../../domain/sharing/names.service";
import { connect_code_repo, connection_repo } from "../../repositories/sharing";

const MAX_CODE_ATTEMPTS = 3;

export interface MyConnectCodeResult {
  code: string;
  expires_at_ms: number;
  connection_count: number;
  connection_limit: number;
}

/** Returns the caller's current code, issuing a new one when needed. */
export async function get_my_connect_code_orchestrator(
  ctx: OrchestratorContext<{ refresh: boolean }>
): Promise<MyConnectCodeResult> {
  const span = create_span(ctx, "orchestrator", "get_my_connect_code");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  // 1. RESOLVER
  const { existing, connection_count } = await resolve_my_code(ctx, ctx.user_id);

  // 2. DOMAIN
  let entity = existing;
  if (should_issue_new_code(existing, now_ms, ctx.input.refresh)) {
    let code = "";
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      code = build_code(
        Array.from({ length: CODE_LENGTH }, () => randomInt(CODE_ALPHABET.length))
      );
      if (!(await resolve_code_taken(ctx, code, ctx.user_id, now_ms))) break;
    }
    entity = build_connect_code(ctx.user_id, code, now_ms, existing);

    // 3. REPOSITORY
    await connect_code_repo.save(ctx, entity, now_ms);
  }

  log_operation_success(span, ctx.user_id);
  return {
    code: entity!.code,
    expires_at_ms: entity!.expires_at_ms,
    connection_count,
    connection_limit: MAX_CONNECTIONS,
  };
}

export interface EnterConnectCodeResult {
  outcome: CodeEntryOutcome | "malformed";
  /** The other person, when the code matched someone (never for blocked pairs). */
  person: PersonView | null;
}

/** Handles the caller typing someone else's code. */
export async function enter_connect_code_orchestrator(
  ctx: OrchestratorContext<{ code: string }>
): Promise<EnterConnectCodeResult> {
  const span = create_span(ctx, "orchestrator", "enter_connect_code");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  const code = normalize_entered_code(ctx.input.code);
  if (!code) return { outcome: "malformed", person: null };

  // 1. RESOLVER
  const deps = await resolve_code_entry(ctx, ctx.user_id, code, now_ms);

  // 2. DOMAIN
  const decision = evaluate_code_entry({
    caller_id: ctx.user_id,
    now_ms,
    target: deps.target,
    caller_code: deps.caller_code,
    existing_connection_status: deps.existing_connection?.status ?? null,
    caller_connection_count: deps.caller_connection_count,
    target_connection_count: deps.target_connection_count,
  });

  // 3. REPOSITORY
  if (decision.record_failure) {
    const next = apply_failure(deps.caller_code?.failed_attempts ?? 0, now_ms);
    await connect_code_repo.set_failure_state(
      ctx, ctx.user_id, next.failed_attempts, next.cooldown_until_ms, now_ms
    );
  }
  const other = decision.other_user_id;
  if (decision.record_entry && other) {
    await connect_code_repo.record_entry(ctx, other, ctx.user_id, now_ms);
  }
  if (decision.outcome === "connected" && other) {
    await connection_repo.save(ctx, build_connection(ctx.user_id, other, now_ms), now_ms);
    await connect_code_repo.expire_codes(ctx, [ctx.user_id, other], now_ms);
  }

  log_operation_success(span, ctx.user_id);
  const show_person = other !== null && decision.outcome !== "unavailable";
  return {
    outcome: decision.outcome,
    person: show_person ? person_view(other!, {}) : null,
  };
}
