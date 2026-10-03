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
import { TraceContext } from "../../types";
export declare function get_widget_token_orchestrator(ctx: TraceContext, user_id: string, input: {
    rotate: boolean;
}): Promise<{
    token: string;
}>;
//# sourceMappingURL=get_widget_token.orchestrator.d.ts.map