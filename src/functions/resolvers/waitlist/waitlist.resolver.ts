/**
 * Waitlist Resolver (Website-Waitlist) — read-only.
 *
 * @module resolvers/waitlist/waitlist
 */

import { TraceContext } from "../../types";
import { DependencyResult, no_dependencies } from "../../types/dependency";

/** A signup is standalone: nothing derived depends on it. */
export function resolve_join_waitlist_dependencies(_ctx: TraceContext): DependencyResult {
  return no_dependencies();
}
