import { BaseDocument } from "./index";

// =======================
// USER SYSTEM ROLES
// =======================

// System-level user roles
export enum SystemRole {
  ADMIN = "admin",              // Can do anything including developer settings
  POWER_USER = "power_user",    // Full access except developer settings
  STANDARD_USER = "standard_user", // Cannot add Plaid accounts, can use shared resources
  DEMO_USER = "demo_user"       // View-only access to specific demo account
}

// Legacy user roles (deprecated - kept for backward compatibility)
export enum UserRole {
  ADMIN = "admin",
  EDITOR = "editor",
  VIEWER = "viewer"
}

// =======================
// DEMO ACCOUNTS
// =======================

export interface DemoAccount extends BaseDocument {
  name: string;
  description: string;
  isActive: boolean;
  allowedDemoUsers: string[]; // User IDs with demo_user role
  createdBy: string;
  sampleDataGenerated: boolean;
}

// =======================
// SYSTEM ROLE CAPABILITIES
// =======================

export interface SystemRoleCapabilities {
  canAddPlaidAccounts: boolean;
  canAccessDeveloperSettings: boolean;
  canCreateBudgets: boolean;
  canCreateTransactions: boolean;
  canShareResources: boolean;
  canJoinGroups: boolean;
  canCreateGroups: boolean;
}

export const ROLE_CAPABILITIES: Record<SystemRole, SystemRoleCapabilities> = {
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
