"use strict";
/**
 * Groups Main Types
 *
 * Type definitions for core group functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvitationStatus = exports.GroupMemberRole = void 0;
/**
 * Group Member Roles
 */
var GroupMemberRole;
(function (GroupMemberRole) {
    GroupMemberRole["OWNER"] = "owner";
    GroupMemberRole["ADMIN"] = "admin";
    GroupMemberRole["EDITOR"] = "editor";
    GroupMemberRole["VIEWER"] = "viewer"; // Read-only access
})(GroupMemberRole || (exports.GroupMemberRole = GroupMemberRole = {}));
/**
 * Invitation Status
 */
var InvitationStatus;
(function (InvitationStatus) {
    InvitationStatus["PENDING"] = "pending";
    InvitationStatus["ACCEPTED"] = "accepted";
    InvitationStatus["DECLINED"] = "declined";
    InvitationStatus["EXPIRED"] = "expired";
    InvitationStatus["CANCELLED"] = "cancelled";
})(InvitationStatus || (exports.InvitationStatus = InvitationStatus = {}));
//# sourceMappingURL=index.js.map