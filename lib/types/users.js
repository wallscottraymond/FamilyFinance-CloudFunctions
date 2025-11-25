"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_CAPABILITIES = exports.UserRole = exports.SystemRole = void 0;
// =======================
// USER SYSTEM ROLES
// =======================
// System-level user roles
var SystemRole;
(function (SystemRole) {
    SystemRole["ADMIN"] = "admin";
    SystemRole["POWER_USER"] = "power_user";
    SystemRole["STANDARD_USER"] = "standard_user";
    SystemRole["DEMO_USER"] = "demo_user"; // View-only access to specific demo account
})(SystemRole || (exports.SystemRole = SystemRole = {}));
// Legacy user roles (deprecated - kept for backward compatibility)
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "admin";
    UserRole["EDITOR"] = "editor";
    UserRole["VIEWER"] = "viewer";
})(UserRole || (exports.UserRole = UserRole = {}));
exports.ROLE_CAPABILITIES = {
    [SystemRole.ADMIN]: {
        canAddPlaidAccounts: true,
        canAccessDeveloperSettings: true,
        canCreateBudgets: true,
        canCreateTransactions: true,
        canShareResources: true,
        canJoinGroups: true,
        canCreateGroups: true,
    },
    [SystemRole.POWER_USER]: {
        canAddPlaidAccounts: true,
        canAccessDeveloperSettings: false,
        canCreateBudgets: true,
        canCreateTransactions: true,
        canShareResources: true,
        canJoinGroups: true,
        canCreateGroups: true,
    },
    [SystemRole.STANDARD_USER]: {
        canAddPlaidAccounts: false,
        canAccessDeveloperSettings: false,
        canCreateBudgets: true,
        canCreateTransactions: true,
        canShareResources: true,
        canJoinGroups: true,
        canCreateGroups: true,
    },
    [SystemRole.DEMO_USER]: {
        canAddPlaidAccounts: false,
        canAccessDeveloperSettings: false,
        canCreateBudgets: false,
        canCreateTransactions: false,
        canShareResources: false,
        canJoinGroups: false,
        canCreateGroups: false,
    },
};
//# sourceMappingURL=users.js.map