# RBAC & Group-Based Sharing Implementation Status

**Started:** 2025-01-24
**Last Updated:** 2025-01-24
**Status:** IN PROGRESS
**Completion:** ~20%

---

## Overview

This document tracks the progress of implementing the comprehensive RBAC (Role-Based Access Control) and group-based sharing system to replace the current family-based permissions.

---

## Phase 1: Backend Type System ✅ COMPLETED (2025-01-24)

### Completed Items:
- [x] Created `/src/types/users.ts` with new SystemRole enum and DemoAccount interface
- [x] Created `/src/types/groups.ts` with Group, GroupMembership, and API type interfaces
- [x] Created `/src/types/sharing.ts` with ResourceSharing, ResourceShare, and permission interfaces
- [x] Updated main `/src/types/index.ts` to export new modular types
- [x] Updated `User` interface with `systemRole` and `groupMemberships` (optional during migration)
- [x] Updated `Budget` interface with `ownerId` and `sharing` fields (optional during migration)
- [x] Added backward compatibility for legacy `familyId` and `UserRole` (kept as required fields)
- [x] Fixed TypeScript compilation errors for backward compatibility
- [x] Deployed Cloud Functions with new RBAC type system

### New Type Files Created:
1. **users.ts** - SystemRole enum, DemoAccount interface, Role Capabilities matrix
2. **groups.ts** - Group, GroupMember, GroupMembership, GroupSettings, and API types
3. **sharing.ts** - ResourceSharing, ResourceShare, ResourcePermissions, and API types

### Documentation Updated:
- [x] Updated `/CLAUDE.md` with comprehensive RBAC section
- [x] Updated `/FamilyFinanceMobile/src/contexts/CLAUDE.md` with RBAC migration notice
- [x] Updated `/FamilyFinanceMobile/src/services/CLAUDE.md` with RBAC migration notice
- [x] Updated `/FamilyFinance-CloudFunctions/src/functions/budgets/CLAUDE.md` with RBAC migration notice
- [x] Updated `/FamilyFinance-CloudFunctions/src/functions/rules/CLAUDE.md` with RBAC migration notice
- [x] Updated `/FamilyFinance-CloudFunctions/src/functions/outflows/CLAUDE.md` with RBAC migration notice

---

## Phase 2: Update All Resource Types 🔄 IN PROGRESS

### Remaining Resource Types to Update:

#### High Priority:
- [ ] **Transaction** - Add `SharedResource` fields
- [ ] **BudgetPeriodDocument** - Add sharing with inheritance
- [ ] **OutflowPeriod** - Add sharing with inheritance
- [ ] **InflowPeriod** - Add sharing with inheritance
- [ ] **Plaid Account** - Add sharing (special permissions for balance visibility)
- [ ] **PlaidItem** - Add sharing

#### Medium Priority:
- [ ] **RecurringOutflow** - Add sharing
- [ ] **RecurringIncome** - Add sharing
- [ ] **Category** - Evaluate if sharing is needed

### Template for Updating Resource Types:

```typescript
export interface ResourceName extends BaseDocument {
  // ... existing fields ...

  // NEW: Ownership and sharing
  createdBy: string;
  ownerId: string;
  sharing: ResourceSharing;

  // DEPRECATED: Legacy fields
  familyId?: string;  // Keep for backward compatibility
  userId?: string;    // Keep for backward compatibility
}
```

---

## Phase 3: Firestore Security Rules ⏸️ NOT STARTED

### Files to Update:
- [ ] `/FamilyFinance-CloudFunctions/firestore.rules`

### New Helper Functions Needed:
```javascript
// System role checks
function hasSystemRole(role) { ... }
function isAdmin() { ... }
function isPowerUser() { ... }
function canAddPlaidAccounts() { ... }

// Group membership checks
function userBelongsToGroup(groupId) { ... }
function getUserGroupRole(groupId) { ... }

// Resource access checks
function hasResourceAccess(resource, minRole) { ... }
function isResourceOwner(ownerId) { ... }
function hasMinimumRole(userRole, requiredRole) { ... }
```

### Collections to Update:
1. **groups** - New collection rules
2. **demo_accounts** - New collection rules
3. **budgets** - Update with sharing checks
4. **budget_periods** - Update with inheritance
5. **transactions** - Update with sharing checks
6. **accounts** - Update with sharing + Plaid restrictions
7. **outflows** - Update with sharing checks
8. **outflow_periods** - Update with inheritance
9. **inflows** - Update with sharing checks
10. **inflow_periods** - Update with inheritance

---

## Phase 4: Cloud Functions ⏸️ NOT STARTED

### Group Management Functions:
- [ ] `createGroup`
- [ ] `addGroupMember`
- [ ] `removeGroupMember`
- [ ] `updateGroupMemberRole`
- [ ] `transferGroupOwnership`
- [ ] `leaveGroup`
- [ ] `deleteGroup`

### Sharing Management Functions:
- [ ] `shareResource`
- [ ] `unshareResource`
- [ ] `updateSharePermissions`
- [ ] `getUserSharedResources`
- [ ] `getResourceShares`

### Permission Check Functions:
- [ ] `checkUserResourceAccess`
- [ ] `getUserAccessibleResources`

### Triggers:
- [ ] `onGroupMemberRemoved` → Cleanup resource access
- [ ] `onUserDeleted` → Handle ownership transfer
- [ ] `onBudgetCreated` → Create budget_periods with inherited sharing

---

## Phase 5: Data Migration ⏸️ NOT STARTED

### Migration Scripts Needed:
- [ ] Migrate `families` → `groups`
- [ ] Migrate user roles → system roles
- [ ] Add sharing fields to existing resources
- [ ] Backfill `createdBy` and `ownerId` fields

### Migration Strategy:
1. Add new fields without removing old (non-breaking)
2. Run migration script to populate new fields
3. Update security rules to support both old and new
4. Gradual deprecation of old fields

---

## Phase 6: Mobile App Updates ⏸️ NOT STARTED

### New Type Files to Create:
- [ ] `/FamilyFinanceMobile/src/types/users.ts`
- [ ] `/FamilyFinanceMobile/src/types/groups.ts`
- [ ] `/FamilyFinanceMobile/src/types/sharing.ts`

### New Contexts to Create:
- [ ] `GroupsContext.tsx` - Group management
- [ ] `SharingContext.tsx` - Resource sharing
- [ ] Update `AuthContext` to include system role

### New Services to Create:
- [ ] `groupService.ts` - Group CRUD operations
- [ ] `sharingService.ts` - Share/unshare operations

### Existing Services to Update:
- [ ] `budgetService.ts` - Add sharing methods
- [ ] `transactionService.ts` - Add sharing methods
- [ ] `accountService.ts` - Add sharing methods (Plaid)
- [ ] All period services - Add sharing with inheritance

### UI Components to Create:
- [ ] Group management screen
- [ ] Share dialog/modal
- [ ] Permission indicator badges
- [ ] Shared resources list view

---

## Phase 7: Documentation Updates ⏸️ NOT STARTED

### Files to Update:
- [ ] `/CLAUDE.md` - Add RBAC architecture section
- [ ] `/FamilyFinance-CloudFunctions/README.md` (if exists)
- [ ] `/FamilyFinanceMobile/README.md` (if exists)
- [ ] `/FamilyFinanceMobile/src/contexts/CLAUDE.md`
- [ ] `/FamilyFinanceMobile/src/services/CLAUDE.md`

### Documentation Sections to Add:
- [ ] RBAC System Overview
- [ ] Group Management Guide
- [ ] Resource Sharing Guide
- [ ] Permission Levels Reference
- [ ] Migration Guide (Families → Groups)
- [ ] Security Model Explanation

---

## Testing Strategy

### Unit Tests:
- [ ] Permission check functions
- [ ] Role hierarchy validation
- [ ] Share/unshare operations
- [ ] Group membership operations

### Integration Tests:
- [ ] End-to-end resource sharing workflows
- [ ] Group membership changes affecting access
- [ ] Permission inheritance (budget → budget_periods)

### Security Tests:
- [ ] Unauthorized access attempts
- [ ] Role restriction enforcement (standard_user can't add Plaid)
- [ ] Permission escalation attempts

---

## Known Issues & Risks

### Security Risks:
- ⚠️ Permission bypass if security rules not comprehensive
- ⚠️ Orphaned resources if owner deletion not handled
- ⚠️ Recursive sharing if not properly restricted

### Performance Risks:
- ⚠️ Complex sharing queries could be slow
- ⚠️ `sharing.sharedWith` array growth (limit to 50?)
- ⚠️ Need composite indexes for shared resource queries

### Migration Risks:
- ⚠️ Data consistency during transition
- ⚠️ Backward compatibility with mobile app versions
- ⚠️ User confusion during role system change

---

## Next Steps (Immediate)

1. **Complete Phase 2** - Update remaining resource type interfaces
2. **Start Phase 3** - Implement Firestore security rules
3. **Create Phase 4** - Implement core Cloud Functions
4. **Test Phase** - Validate security and permissions
5. **Document** - Update all CLAUDE.md files

---

## Estimated Timeline

- **Phase 1** (Types): ✅ DONE (Day 1)
- **Phase 2** (Resource Types): 🔄 IN PROGRESS (Day 1-2)
- **Phase 3** (Security Rules): Day 2-5
- **Phase 4** (Cloud Functions): Day 5-12
- **Phase 5** (Migration): Day 13-15
- **Phase 6** (Mobile App): Day 16-25
- **Phase 7** (Documentation): Day 26-30

**Total Estimated Time:** 30 days (6 weeks)

---

## Questions & Decisions

### Open Questions:
1. **Group size limits?** Max members per group?
   - Recommendation: 50 members max
2. **Share limits?** Max shares per resource?
   - Recommendation: 50 shares max per resource
3. **Transfer ownership?** Should editors request transfer?
   - Recommendation: Owner-initiated only
4. **Audit logging?** Track all permission changes?
   - Recommendation: Yes, in `audit_logs` collection
5. **Notifications?** Alert on resource shares?
   - Recommendation: Yes, optional per-user setting
6. **Demo account?** Multiple demos or single shared?
   - Recommendation: Multiple demo accounts, user assigned to one

### Decisions Made:
- ✅ Use modular type system (separate files)
- ✅ Maintain backward compatibility with `familyId`
- ✅ Implement permission inheritance for period resources
- ✅ Four system roles (admin, power_user, standard_user, demo_user)
- ✅ Three resource roles (owner, editor, viewer)
- ✅ Fine-grained permissions via `ResourcePermissions`

---

## Contact & Support

For questions about this implementation:
- Review this document first
- Check CLAUDE.md for architecture details
- Review type definitions in `/src/types/`

Last Updated: 2025-01-XX
