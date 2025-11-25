"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceRole = void 0;
// =======================
// RESOURCE SHARING SYSTEM
// =======================
// Role for resource-level access (different from group role)
var ResourceRole;
(function (ResourceRole) {
    ResourceRole["OWNER"] = "owner";
    ResourceRole["EDITOR"] = "editor";
    ResourceRole["VIEWER"] = "viewer"; // Can only view the resource
})(ResourceRole || (exports.ResourceRole = ResourceRole = {}));
//# sourceMappingURL=sharing.js.map