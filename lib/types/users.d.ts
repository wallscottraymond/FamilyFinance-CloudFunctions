import { BaseDocument } from "./index";
export declare enum SystemRole {
    ADMIN = "admin",// Can do anything including developer settings
    POWER_USER = "power_user",// Full access except developer settings
    STANDARD_USER = "standard_user",// Cannot add Plaid accounts, can use shared resources
    DEMO_USER = "demo_user"
}
export declare enum UserRole {
    ADMIN = "admin",
    EDITOR = "editor",
    VIEWER = "viewer"
}
export interface DemoAccount extends BaseDocument {
    name: string;
    description: string;
    isActive: boolean;
    allowedDemoUsers: string[];
    createdBy: string;
    sampleDataGenerated: boolean;
}
export interface SystemRoleCapabilities {
    canAddPlaidAccounts: boolean;
    canAccessDeveloperSettings: boolean;
    canCreateBudgets: boolean;
    canCreateTransactions: boolean;
    canShareResources: boolean;
    canJoinGroups: boolean;
    canCreateGroups: boolean;
}
export declare const ROLE_CAPABILITIES: Record<SystemRole, SystemRoleCapabilities>;
//# sourceMappingURL=users.d.ts.map