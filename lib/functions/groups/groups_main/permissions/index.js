"use strict";
/**
 * Permission Check Functions
 *
 * Functions for checking and querying user permissions on resources.
 * Part of the RBAC v2 system.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserAccessibleResources = exports.checkUserResourceAccess = void 0;
// Check if a user has access to a specific resource
var checkUserResourceAccess_1 = require("./checkUserResourceAccess");
Object.defineProperty(exports, "checkUserResourceAccess", { enumerable: true, get: function () { return checkUserResourceAccess_1.checkUserResourceAccess; } });
// Get all resources a user can access
var getUserAccessibleResources_1 = require("./getUserAccessibleResources");
Object.defineProperty(exports, "getUserAccessibleResources", { enumerable: true, get: function () { return getUserAccessibleResources_1.getUserAccessibleResources; } });
//# sourceMappingURL=index.js.map