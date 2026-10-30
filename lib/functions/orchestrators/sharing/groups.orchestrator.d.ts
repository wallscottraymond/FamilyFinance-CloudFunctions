/**
 * Group Orchestrators (D4, D24–D26, D30)
 *
 * create_group: creates the group (caller = owner) and sends join requests.
 * add_to_group: sends a join request to a connected person.
 * respond_to_request: accept (joins atomically) or decline.
 * manage_group: rename / remove_member / transfer_ownership / leave / delete.
 *
 * Joining never happens without the invitee's Accept (D25).
 *
 * @module orchestrators/sharing/groups
 */
import { OrchestratorContext } from "../../types";
export interface SharingWriteResult {
    success: boolean;
    errors?: string[];
    group_id?: string;
}
/** Creates a group and invites connected people. */
export declare function create_group_orchestrator(ctx: OrchestratorContext<{
    name: string;
    invitee_ids: string[];
}>): Promise<SharingWriteResult>;
/** Sends a join request to someone the caller is connected with. */
export declare function add_to_group_orchestrator(ctx: OrchestratorContext<{
    group_id: string;
    invitee_id: string;
}>): Promise<SharingWriteResult>;
/** Accepts or declines a request addressed to the caller. */
export declare function respond_to_request_orchestrator(ctx: OrchestratorContext<{
    request_id: string;
    accept: boolean;
}>): Promise<SharingWriteResult>;
export type ManageGroupInput = {
    group_id: string;
    action: "rename";
    name: string;
} | {
    group_id: string;
    action: "remove_member";
    user_id: string;
} | {
    group_id: string;
    action: "transfer_ownership";
    user_id: string;
} | {
    group_id: string;
    action: "leave";
} | {
    group_id: string;
    action: "delete";
};
/**
 * Owner / member group management. Leaving / removal / deletion also make the
 * departing people's shared accounts private again and cancel their pending
 * requests, and budgets they moved in go back to their Me view (D13).
 */
export declare function manage_group_orchestrator(ctx: OrchestratorContext<ManageGroupInput>): Promise<SharingWriteResult>;
//# sourceMappingURL=groups.orchestrator.d.ts.map