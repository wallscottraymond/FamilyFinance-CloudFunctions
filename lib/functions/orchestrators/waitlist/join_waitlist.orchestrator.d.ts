/**
 * Join-waitlist orchestrator (Website-Waitlist)
 *
 * Resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 * The doc id comes from the email, so a double submit can't create two entries.
 *
 * @module orchestrators/waitlist/join_waitlist
 */
import { TraceContext } from "../../types";
import { JoinWaitlistInput, JoinWaitlistStatus } from "../../types/waitlist.types";
export declare function join_waitlist_orchestrator(ctx: TraceContext, input: JoinWaitlistInput, ip: string, now_ms?: number): Promise<JoinWaitlistStatus>;
//# sourceMappingURL=join_waitlist.orchestrator.d.ts.map