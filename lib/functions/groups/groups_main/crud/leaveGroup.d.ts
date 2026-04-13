interface LeaveGroupRequest {
    groupId: string;
}
interface LeaveGroupResponse {
    success: boolean;
    message?: string;
}
/**
 * Leave a group (user removes themselves)
 *
 * Any member can leave a group except the owner.
 * Owner must transfer ownership or delete the group instead.
 */
export declare const leaveGroup: import("firebase-functions/v2/https").CallableFunction<LeaveGroupRequest, Promise<LeaveGroupResponse>>;
export {};
//# sourceMappingURL=leaveGroup.d.ts.map