/**
 * Recurring capabilities (Convert-To-Recurring Phase 2): the app can't read `_feature_flags`, so it
 * asks. Returns ONLY `{enabled}` — nothing else about the flag, the rollout or other users.
 *
 * @module orchestrators/recurring/get_recurring_capabilities
 */
import { TraceContext } from "../../types";
export declare function get_recurring_capabilities_orchestrator(_ctx: TraceContext, user_id: string): Promise<{
    enabled: boolean;
}>;
//# sourceMappingURL=get_recurring_capabilities.orchestrator.d.ts.map