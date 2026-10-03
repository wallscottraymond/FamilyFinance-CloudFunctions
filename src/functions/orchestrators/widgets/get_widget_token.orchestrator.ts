/**
 * Get Widget Token Orchestrator ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Returns the account's read-only widget token, creating it on first use; `rotate` issues a
 * new one and revokes the old ("Reset widget access"). One token per account, stored
 * encrypted so every signed-in device of the account gets the SAME token (signing out on one
 * phone must not break the other phone's widgets).
 *
 * @module orchestrators/widgets/get_widget_token
 */

import { randomBytes } from "crypto";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { resolve_stored_widget_token } from "../../resolvers/widgets/widget.resolver";
import { widget_token_repo } from "../../repositories/widget_token.repo";
import { encryptForStorage, decryptFromStorage } from "../../../utils/encryption";
import { hash_widget_token } from "../../domain/widgets/widget_token.service";

export async function get_widget_token_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: { rotate: boolean }
): Promise<{ token: string }> {
  const span = create_span(ctx, "orchestrator", "get_widget_token");
  log_operation_start(span, user_id);
  try {
    const stored = await resolve_stored_widget_token(user_id);
    if (stored && !input.rotate) {
      log_operation_success(span, user_id);
      return { token: decryptFromStorage(stored.encrypted_token) };
    }

    const token = randomBytes(32).toString("base64url"); // 256-bit, unguessable
    await widget_token_repo.save(
      user_id,
      { encrypted_token: encryptForStorage(token), token_hash: hash_widget_token(token) },
      stored?.token_hash ?? null
    );
    log_operation_success(span, user_id);
    return { token };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
      user_id,
    });
    throw error;
  }
}
