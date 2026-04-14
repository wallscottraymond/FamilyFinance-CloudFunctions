"use strict";
/**
 * Resource Sharing Functions
 *
 * Functions for sharing resources (budgets, transactions, etc.) with users and groups.
 * Part of the RBAC v2 system using onCall pattern and groupIds[].
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResourceShares = exports.getUserSharedResources = exports.updateSharePermissions = exports.unshareResource = exports.shareResource = void 0;
// Share a resource with a user or group
var shareResource_1 = require("./shareResource");
Object.defineProperty(exports, "shareResource", { enumerable: true, get: function () { return shareResource_1.shareResource; } });
// Remove sharing from a resource
var unshareResource_1 = require("./unshareResource");
Object.defineProperty(exports, "unshareResource", { enumerable: true, get: function () { return unshareResource_1.unshareResource; } });
// Update permissions for an existing share
var updateSharePermissions_1 = require("./updateSharePermissions");
Object.defineProperty(exports, "updateSharePermissions", { enumerable: true, get: function () { return updateSharePermissions_1.updateSharePermissions; } });
// Get all resources shared with the current user
var getUserSharedResources_1 = require("./getUserSharedResources");
Object.defineProperty(exports, "getUserSharedResources", { enumerable: true, get: function () { return getUserSharedResources_1.getUserSharedResources; } });
// Get all shares for a specific resource
var getResourceShares_1 = require("./getResourceShares");
Object.defineProperty(exports, "getResourceShares", { enumerable: true, get: function () { return getResourceShares_1.getResourceShares; } });
//# sourceMappingURL=index.js.map