/**
 * Connections Orchestrators (D27, D28)
 *
 * get_sharing_overview: everything the Groups screen shows, in one call.
 * manage_connection: nickname / disconnect / block / report.
 *
 * @module orchestrators/sharing/connections
 */
import { OrchestratorContext } from "../../types";
import { SharingOverview } from "../../domain/sharing/sharing_overview.service";
/** The Groups-screen read model. Read-only: no idempotency, no writes. */
export declare function get_sharing_overview_orchestrator(ctx: OrchestratorContext<Record<string, never>>): Promise<SharingOverview>;
export type ManageConnectionInput = {
    action: "set_nickname";
    other_user_id: string;
    nickname: string;
} | {
    action: "disconnect";
    other_user_id: string;
} | {
    action: "block";
    other_user_id: string;
} | {
    action: "report";
    other_user_id: string;
    reason: string;
};
export interface ManageConnectionResult {
    success: boolean;
    errors?: string[];
}
/**
 * Applies a connection action. Report = block + a report record (D27). Blocking
 * also cancels pending requests between the two people. Someone who isn't
 * connected can still be blocked if they sent the caller a request.
 */
export declare function manage_connection_orchestrator(ctx: OrchestratorContext<ManageConnectionInput>): Promise<ManageConnectionResult>;
//# sourceMappingURL=connections.orchestrator.d.ts.map