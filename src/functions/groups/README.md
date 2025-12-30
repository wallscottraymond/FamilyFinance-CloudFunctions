# Groups Module

Comprehensive group-based sharing and collaboration system for Family Finance.

## Overview

The Groups module enables multi-user collaboration on financial resources through a flexible, secure group-based sharing architecture. It replaces the legacy family-based system with a more scalable approach that supports multiple groups per user and granular permission control.

## Module Structure

### 📁 Directory Organization

```
groups/
├── groups_main/           # Core group management
│   ├── __tests__/        # Unit and integration tests
│   ├── admin/            # Administrative functions
│   ├── api/              # HTTP and callable API endpoints
│   ├── crud/             # Create, Read, Update, Delete operations
│   ├── dev/              # Development and testing utilities
│   ├── triggers/         # Firestore triggers
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Shared utility functions
│
├── groups_periods/        # Period-based group tracking
│   ├── __tests__/
│   ├── admin/
│   ├── api/
│   ├── crud/
│   ├── dev/
│   ├── triggers/
│   ├── types/
│   └── utils/
│
└── groups_summaries/      # Aggregated group data
    ├── __tests__/
    ├── admin/
    ├── api/
    ├── crud/
    ├── dev/
    ├── triggers/
    ├── types/
    └── utils/
```

## Architecture

### 1. **groups_main** - Core Group Management

**Purpose**: Foundation of the group system, handling group creation, member management, and core group functionality.

**Key Responsibilities**:
- Group CRUD operations
- Member invitation and management
- Role-based access control
- Group settings and configuration
- Member activity tracking

**Collections**:
- `/groups/{groupId}` - Group documents
- `/groups/{groupId}/members/{userId}` - Member subcollection
- `/group_invitations/{invitationId}` - Pending invitations

**Key Types**:
- `Group` - Main group document
- `GroupMember` - Member relationship
- `GroupInvitation` - Invitation tracking
- `GroupMemberRole` - Permission levels (OWNER, ADMIN, EDITOR, VIEWER)

### 2. **groups_periods** - Period-Based Tracking

**Purpose**: Track group activity and metrics over time periods.

**Key Responsibilities**:
- Generate period documents for groups
- Track member activity by period
- Calculate period-specific metrics
- Support temporal analytics

**Collections**:
- `/group_periods/{groupId}/periods/{periodId}` - Period metrics

**Key Types**:
- `GroupPeriod` - Period document
- `GroupPeriodMetrics` - Aggregated metrics

### 3. **groups_summaries** - Aggregated Data

**Purpose**: Real-time aggregated summaries of shared financial resources.

**Key Responsibilities**:
- Aggregate shared outflows by group
- Aggregate shared inflows by group
- Aggregate shared budgets by group
- Real-time updates via triggers
- Support efficient frontend queries

**Collections**:
- `/group_summaries/{groupId}/outflow_summaries/{summaryId}` - Shared outflows
- `/group_summaries/{groupId}/inflow_summaries/{summaryId}` - Shared inflows
- `/group_summaries/{groupId}/budget_summaries/{summaryId}` - Shared budgets

**Key Types**:
- `GroupOutflowSummary` - Aggregated outflow data
- `GroupInflowSummary` - Aggregated inflow data
- `GroupOutflowEntry` - Individual outflow in summary
- `GroupInflowEntry` - Individual inflow in summary

## Subdirectory Purposes

### `__tests__/`
Unit and integration tests for the module's functionality.

### `admin/`
Administrative functions requiring elevated permissions:
- Group deletion and archiving
- Force remove members
- Bulk operations
- Debug utilities

### `api/`
HTTP and callable Cloud Functions accessible from frontend:
- Group creation and updates
- Member management
- Invitation handling
- Summary queries

### `crud/`
Core database operations (used internally by api/, triggers/):
- Firestore read/write operations
- Validation logic
- Error handling
- Transaction management

### `dev/`
Development and testing utilities:
- Mock data generation
- Test group creation
- Development-only endpoints
- Debugging functions

### `triggers/`
Firestore event triggers:
- `onGroupCreated` - Initialize group resources
- `onGroupMemberAdded` - Update member counts, summaries
- `onGroupMemberRemoved` - Clean up member data
- `onGroupDeleted` - Clean up all group resources

### `types/`
TypeScript interfaces and type definitions:
- Document structures
- API request/response types
- Enums and constants
- Utility types

### `utils/`
Shared utility functions:
- Validation helpers
- Permission checks
- Data transformation
- Common calculations

## Data Flow

### Group Summary Updates (Example)

```
User creates/updates outflow with groupIds: ['group1']
    ↓
outflows/{outflowId} created/updated
    ↓
[TRIGGER] onOutflowCreated/onOutflowUpdated
    ↓
Check: Does outflow have groupIds?
    ↓
YES → groups_summaries/utils/updateGroupOutflowSummary()
    ↓
Update /group_summaries/{groupId}/outflow_summaries/{periodId}
    ↓
All group members see updated summary in realtime
```

### Group Creation Flow

```
User calls createGroup API
    ↓
groups_main/api/createGroup
    ↓
groups_main/crud/createGroup
    ↓
Write to /groups/{groupId}
    ↓
[TRIGGER] onGroupCreated
    ↓
groups_main/triggers/onGroupCreated
    ↓
- Add creator as OWNER member
- Initialize group summaries
- Create default periods
```

## Integration Points

### With Outflows Module
- Outflows check `groupIds` array to determine summary destination
- Triggers route updates to group summaries when `groupIds` present
- Shared outflows visible to all group members

### With User Module
- User documents maintain `groupIds` array for membership tracking
- User preferences may include group-specific settings
- User permissions checked against group membership

### With Firestore Security Rules
```javascript
// Group summaries readable by group members
match /group_summaries/{groupId}/{document=**} {
  allow read: if isGroupMember(groupId);
  allow write: if false; // Only cloud functions write
}
```

## Development Workflow

### Adding a New Feature

1. **Define Types** in `types/index.ts`
2. **Create Utils** in `utils/` for business logic
3. **Implement CRUD** in `crud/` for database operations
4. **Build API** in `api/` for frontend access
5. **Add Triggers** in `triggers/` for automation
6. **Write Tests** in `__tests__/`
7. **Export** from module's `index.ts`

### Example: Adding Group Budget Summaries

```typescript
// 1. Define types (groups_summaries/types/index.ts)
export interface GroupBudgetSummary { ... }

// 2. Create utility (groups_summaries/utils/buildGroupBudgetSummary.ts)
export function buildGroupBudgetSummary(...) { ... }

// 3. Create trigger (groups_summaries/triggers/onBudgetUpdated.ts)
export const onBudgetUpdated = onDocumentWritten(...) { ... }

// 4. Export from module (groups_summaries/index.ts)
export * from './triggers/onBudgetUpdated';
```

## Security Model

### Permission Hierarchy

```
OWNER > ADMIN > EDITOR > VIEWER
```

**OWNER**:
- Full control of group
- Can delete group
- Can transfer ownership
- Can remove any member

**ADMIN**:
- Can manage members (except owner)
- Can edit group settings
- Can manage shared resources

**EDITOR**:
- Can edit shared resources
- Can add resources to group
- Cannot manage members

**VIEWER**:
- Read-only access
- Can view shared resources
- Cannot edit anything

## Future Enhancements

- [ ] Group templates for common setups
- [ ] Group-level budgets and goals
- [ ] Advanced analytics and reporting
- [ ] Group activity feed
- [ ] Group chat/comments
- [ ] Nested groups/subgroups
- [ ] Group export/import
- [ ] Public groups and discovery

## Migration Notes

This module is part of the larger migration from the legacy `familyId`-based system to the new `groupIds`-based system. During the transition:

1. Both systems are supported
2. Security rules check both `familyId` and `groupIds`
3. Legacy data will be migrated incrementally
4. New features use `groupIds` exclusively

See `/SHARING.md` for complete migration documentation.
