/**
 * Feedback Resolver (Feedback-And-Questions) — read-only.
 *
 * - A send touches nothing derived (no budgets, periods or caches), so it has no dependencies.
 * - Inbox calls need the owner allowlist flag; the domain decides what it means.
 *
 * @module resolvers/feedback/feedback
 */
import { TraceContext } from "../../types";
import { DependencyResult } from "../../types/dependency";
import { InboxFlagLike } from "../../domain/feedback/feedback.service";
/** A note is standalone: nothing derived depends on it. */
export declare function resolve_submit_feedback_dependencies(_ctx: TraceContext): DependencyResult;
/** The inbox allowlist flag; any read problem reads as "no flag" (= nobody is an owner). */
export declare function resolve_inbox_flag(_ctx: TraceContext): Promise<InboxFlagLike | null>;
//# sourceMappingURL=feedback.resolver.d.ts.map