interface DeleteGroupRequest {
    groupId: string;
    confirm: boolean;
}
interface DeleteGroupResponse {
    success: boolean;
    message?: string;
}
/**
 * Delete a group (soft delete by setting isActive to false)
 *
 * Only the group owner can delete a group.
 * All members' groupIds arrays are updated automatically.
 */
export declare const deleteGroup: import("firebase-functions/v2/https").CallableFunction<DeleteGroupRequest, Promise<DeleteGroupResponse>, unknown>;
export {};
//# sourceMappingURL=deleteGroup.d.ts.map