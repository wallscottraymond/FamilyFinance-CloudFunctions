"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupRole = void 0;
// =======================
// GROUP SYSTEM
// =======================
// Role within a specific group (not system-wide)
var GroupRole;
(function (GroupRole) {
    GroupRole["OWNER"] = "owner";
    GroupRole["ADMIN"] = "admin";
    GroupRole["EDITOR"] = "editor";
    GroupRole["VIEWER"] = "viewer"; // Can view and leave notes only
})(GroupRole || (exports.GroupRole = GroupRole = {}));
//# sourceMappingURL=groups.js.map