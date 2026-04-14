"use strict";
/**
 * Group CRUD Operations (RBAC v2)
 *
 * Core group management functions using onCall pattern with groupIds[].
 * These replace the legacy sharing module (onRequest with familyId).
 *
 * Renamed to avoid conflicts with legacy sharing module:
 * - createGroupV2 (was createGroup)
 * - leaveGroupV2 (was leaveGroup)
 * - removeGroupMemberV2 (was removeGroupMember)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferGroupOwnership = exports.leaveGroupV2 = exports.updateGroupMemberRoleV2 = exports.removeGroupMemberV2 = exports.addGroupMemberV2 = exports.deleteGroupV2 = exports.createGroupV2 = void 0;
// Group lifecycle - renamed to avoid conflicts with legacy sharing module
var createGroup_1 = require("./createGroup");
Object.defineProperty(exports, "createGroupV2", { enumerable: true, get: function () { return createGroup_1.createGroup; } });
var deleteGroup_1 = require("./deleteGroup");
Object.defineProperty(exports, "deleteGroupV2", { enumerable: true, get: function () { return deleteGroup_1.deleteGroup; } });
// Member management - some renamed to avoid conflicts
var addGroupMember_1 = require("./addGroupMember");
Object.defineProperty(exports, "addGroupMemberV2", { enumerable: true, get: function () { return addGroupMember_1.addGroupMember; } });
var removeGroupMember_1 = require("./removeGroupMember");
Object.defineProperty(exports, "removeGroupMemberV2", { enumerable: true, get: function () { return removeGroupMember_1.removeGroupMember; } });
var updateGroupMemberRole_1 = require("./updateGroupMemberRole");
Object.defineProperty(exports, "updateGroupMemberRoleV2", { enumerable: true, get: function () { return updateGroupMemberRole_1.updateGroupMemberRole; } });
var leaveGroup_1 = require("./leaveGroup");
Object.defineProperty(exports, "leaveGroupV2", { enumerable: true, get: function () { return leaveGroup_1.leaveGroup; } });
// Ownership
var transferGroupOwnership_1 = require("./transferGroupOwnership");
Object.defineProperty(exports, "transferGroupOwnership", { enumerable: true, get: function () { return transferGroupOwnership_1.transferGroupOwnership; } });
//# sourceMappingURL=index.js.map