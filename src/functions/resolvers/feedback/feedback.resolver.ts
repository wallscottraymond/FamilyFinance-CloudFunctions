/**
 * Feedback Resolver (Feedback-And-Questions) — read-only.
 *
 * - A send touches nothing derived (no budgets, periods or caches), so it has no dependencies.
 * - Inbox calls need the owner allowlist flag; the domain decides what it means.
 *
 * @module resolvers/feedback/feedback
 */

import { TraceContext } from "../../types";
import { DependencyResult, no_dependencies } from "../../types/dependency";
import { get_feature_flag } from "../../infrastructure/feature_flags";
import { InboxFlagLike } from "../../domain/feedback/feedback.service";
import { FEEDBACK_INBOX_FLAG } from "../../types/feedback.types";

/** A note is standalone: nothing derived depends on it. */
export function resolve_submit_feedback_dependencies(_ctx: TraceContext): DependencyResult {
  return no_dependencies();
}

/** The inbox allowlist flag; any read problem reads as "no flag" (= nobody is an owner). */
export async function resolve_inbox_flag(_ctx: TraceContext): Promise<InboxFlagLike | null> {
  try {
    return await get_feature_flag(FEEDBACK_INBOX_FLAG);
  } catch (error) {
    console.warn(`[feedback] ${FEEDBACK_INBOX_FLAG} unreadable; treating as no owner:`, error);
    return null;
  }
}
