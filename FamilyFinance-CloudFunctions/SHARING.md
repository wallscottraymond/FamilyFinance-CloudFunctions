# Group-Based Sharing System - Architecture Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture Decision: Why groupId Instead of accessibleBy](#architecture-decision)
3. [Group Roles & Permissions](#group-roles--permissions)
4. [Data Model](#data-model)
5. [Security Model](#security-model)
6. [Query Patterns](#query-patterns)
7. [Frontend Integration](#frontend-integration)
8. [Future Implementation](#future-implementation)

---

## Overview

The FamilyFinance application uses a **group-based sharing system** where users can create groups and share financial resources (transactions, budgets, accounts, outflows, etc.) with other members.

### Key Principles

1. **Single Source of Truth**: Group membership is stored in one place (`groups` collection), not denormalized across all resources
2. **Instant Revocation**: Removing a user from a group immediately revokes their access to all shared resources
3. **Role-Based Access Control**: Each group member has a role (owner/admin/editor/viewer) that determines their permissions
4. **Secure by Default**: Security rules enforce access at read-time, preventing stale data exploits

---

## Architecture Decision

### Why We Moved from `accessibleBy` to `groupId`

#### ❌ Previous Approach: `accessibleBy` Array

```typescript
{
  userId: "alice",
  groupId: "family123",
  accessibleBy: ["alice", "bob", "charlie"],  // Denormalized list
  // ...
}
```

**Problems:**
- 🚨 **Stale Data Risk**: Removing Bob from group requires updating ALL documents
- 🚨 **Update Amplification**: 10,000 transactions × group member change = 10,000 writes
- 🚨 **Race Conditions**: Member added/removed while creating transaction
- 🚨 **Security Risk**: Stale `accessibleBy` could allow removed users to access data

#### ✅ Current Approach: Just `groupId`

```typescript
{
  userId: "alice",
  groupId: "family123",  // Just reference to group
  // ...
}
```

**Benefits:**
- ✅ **Single Source of Truth**: Group membership only in `groups` collection
- ✅ **Instant Revocation**: Remove user = 1 write, access immediately revoked
- ✅ **No Stale Data**: Security rules check group membership in real-time
- ✅ **Efficient**: O(1) membership changes instead of O(n) document updates

---

## Group Roles & Permissions

### Role Hierarchy

```
Owner > Admin > Editor > Viewer
```

### Permission Matrix

| Permission          | Owner | Admin | Editor | Viewer |
|--------------------|-------|-------|--------|--------|
| **Resources**      |       |       |        |        |
| View resources     | ✅    | ✅    | ✅     | ✅     |
| Create resources   | ✅    | ✅    | ✅     | ❌     |
| Edit resources     | ✅    | ✅    | ✅     | ❌     |
| Delete resources   | ✅    | ✅    | ❌     | ❌     |
| Add notes          | ✅    | ✅    | ✅     | ✅     |
| **Group Management** |     |       |        |        |
| Invite members     | ✅    | ✅    | ❌     | ❌     |
| Remove members     | ✅    | ✅    | ❌     | ❌     |
| Change roles       | ✅    | ✅*   | ❌     | ❌     |
| Edit group settings| ✅    | ✅    | ❌     | ❌     |
| Delete group       | ✅    | ❌    | ❌     | ❌     |

\* Admins can change roles but cannot remove the owner

### Role Descriptions

**Owner:**
- User who created the group
- Full control over all resources and members
- Only one owner per group
- Can transfer ownership (future feature)
- Can delete the group

**Admin:**
- Trusted member with management privileges
- Can manage members (invite, remove, change roles)
- Cannot remove owner or delete group
- Full access to shared resources

**Editor:**
- Can create and modify shared resources
- Cannot manage group members or settings
- Ideal for family members who manage finances

**Viewer:**
- Read-only access to shared resources
- Can add notes/comments
- Cannot create or modify resources
- Ideal for children or external accountants

---

## Data Model

### Shareable Resource Structure

All shareable resources (transactions, budgets, accounts, outflows, etc.) follow this standard structure:

```typescript
interface ShareableResource {
  // === OWNERSHIP ===
  userId: string;                    // Resource owner (creator)
  groupId: string | null;            // Group this belongs to (null = private)

  // === ACCESS CONTROL (metadata only) ===
  access: {
    createdBy: string;               // Original creator
    ownerId: string;                 // Current owner
    isPrivate: boolean;              // Calculated: groupId === null
    roleOverrides: {                 // Future: per-resource role overrides
      [userId: string]: 'owner' | 'admin' | 'editor' | 'viewer';
    };
  };

  // === LEGACY FIELDS (backward compatibility) ===
  familyId?: string;                 // DEPRECATED: maps to groupId

  // === RESOURCE-SPECIFIC FIELDS ===
  // ... transaction, budget, account fields ...
}
```

### Collections Supporting Sharing

All of these collections use the same sharing structure:

- `transactions` - Bank transactions
- `accounts` - Bank accounts (Plaid)
- `budgets` - Budget templates
- `budget_periods` - Time-based budget periods
- `outflows` - Recurring expenses (bills)
- `outflow_periods` - Bill payment periods
- `inflow` - Income sources
- `inflow_periods` - Income receipt periods

### Groups Collection (Future Implementation)

```typescript
// TODO: Implement when building group management
interface Group {
  id: string;
  name: string;
  description?: string;
  createdBy: string;               // User who created the group
  ownerId: string;                 // Current owner
  members: GroupMember[];          // Array of members with roles
  settings: {
    allowMemberInvites: boolean;
    requireApprovalForSharing: boolean;
    defaultResourceRole: 'editor' | 'viewer';
    maxMembers: number;
  };
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface GroupMember {
  userId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joinedAt: Timestamp;
  invitedBy: string;
  status: 'active' | 'invited' | 'suspended';
}
```

---

## Security Model

### Firestore Security Rules Pattern

All shareable resources use this security rule pattern:

```javascript
// Helper: Check if user is in the group
function userIsInGroup(groupId) {
  return groupId != null && (
    // Legacy: check familyId for backward compatibility
    inSameFamily(groupId) ||
    // Future: check groups collection when implemented
    (exists(/databases/$(database)/documents/groups/$(groupId)) &&
     request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.members)
  );
}

// Helper: Get user's role in group (future)
function getUserRoleInGroup(groupId) {
  // TODO: Implement when groups collection exists
  // For now, return 'editor' for backward compatibility
  if (!exists(/databases/$(database)/documents/groups/$(groupId))) {
    return 'editor';
  }

  let group = get(/databases/$(database)/documents/groups/$(groupId)).data;
  let member = group.members.hasAny([request.auth.uid]);
  return member ? member.role : null;
}

// Example: Transactions collection rules
match /transactions/{transactionId} {
  // READ: Owner or group member
  allow read: if isAuthenticated() && (
    request.auth.uid == resource.data.userId ||
    (resource.data.groupId != null && userIsInGroup(resource.data.groupId))
  );

  // CREATE: Authenticated users
  allow create: if isAuthenticated() &&
                   request.resource.data.userId == request.auth.uid;

  // UPDATE: Owner or group member with edit permissions
  allow update: if isAuthenticated() && (
    request.auth.uid == resource.data.userId ||
    (resource.data.groupId != null &&
     userIsInGroup(resource.data.groupId) &&
     getUserRoleInGroup(resource.data.groupId) in ['owner', 'admin', 'editor'])
  );

  // DELETE: Owner or group admin/owner
  allow delete: if isAuthenticated() && (
    request.auth.uid == resource.data.userId ||
    (resource.data.groupId != null &&
     getUserRoleInGroup(resource.data.groupId) in ['owner', 'admin'])
  );

  // LIST: Allow queries (filtered by read rules)
  allow list: if isAuthenticated();
}
```

### Key Security Features

1. **Real-Time Membership Check**: Security rules check group membership on every read
2. **No Stale Data**: Removed users immediately lose access
3. **Role-Based Permissions**: Future implementation will enforce viewer/editor/admin roles
4. **Defense in Depth**: Both client queries and server rules enforce access control

---

## Query Patterns

### Frontend Query Flow

```typescript
// Step 1: Load user's group memberships (on app start, cached)
const userDoc = await firestore()
  .collection('users')
  .doc(currentUserId)
  .get();

const userGroups = userDoc.data()?.groupMemberships?.map(m => m.groupId) || [];
// Example result: ["family123", "work456"]

// Step 2: Query shared resources across all groups
const sharedTransactions = await firestore()
  .collection('transactions')
  .where('groupId', 'in', userGroups)  // Firestore IN query (max 10 groups)
  .orderBy('date', 'desc')
  .limit(100)
  .get();

// Step 3: Query private resources (groupId === null)
const privateTransactions = await firestore()
  .collection('transactions')
  .where('userId', '==', currentUserId)
  .where('groupId', '==', null)
  .orderBy('date', 'desc')
  .limit(100)
  .get();

// Step 4: Combine results
const allTransactions = [
  ...sharedTransactions.docs.map(d => ({ id: d.id, ...d.data() })),
  ...privateTransactions.docs.map(d => ({ id: d.id, ...d.data() }))
];
```

### Handling Edge Cases

#### User in > 10 Groups

Firestore IN queries support max 10 values. For users in more than 10 groups:

```typescript
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function queryTransactionsForUser(userId: string) {
  const userGroups = await getUserGroupIds(userId);

  if (userGroups.length === 0) {
    // User has no groups, only private transactions
    return firestore()
      .collection('transactions')
      .where('userId', '==', userId)
      .where('groupId', '==', null)
      .orderBy('date', 'desc')
      .get();
  }

  if (userGroups.length <= 10) {
    // Single query
    return firestore()
      .collection('transactions')
      .where('groupId', 'in', userGroups)
      .orderBy('date', 'desc')
      .get();
  }

  // Multiple queries for > 10 groups
  const chunks = chunkArray(userGroups, 10);
  const promises = chunks.map(chunk =>
    firestore()
      .collection('transactions')
      .where('groupId', 'in', chunk)
      .orderBy('date', 'desc')
      .limit(100)
      .get()
  );

  const snapshots = await Promise.all(promises);
  return snapshots.flatMap(s => s.docs);
}
```

**Note:** Most users will be in 1-3 groups (family, work, roommates), so this edge case is rare.

### Required Firestore Indexes

```json
{
  "indexes": [
    // Transactions by groupId + date
    {
      "collectionGroup": "transactions",
      "fields": [
        { "fieldPath": "groupId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    // Transactions by groupId + status + date
    {
      "collectionGroup": "transactions",
      "fields": [
        { "fieldPath": "groupId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    },
    // Similar indexes for: accounts, budgets, budget_periods, outflows, etc.
  ]
}
```

---

## Frontend Integration

### React Native Context for Group Data

```typescript
// src/contexts/GroupContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

interface GroupContextValue {
  userGroupIds: string[];
  loading: boolean;
  refetch: () => Promise<void>;
}

const GroupContext = createContext<GroupContextValue | undefined>(undefined);

export function GroupProvider({ children }) {
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userId = auth().currentUser?.uid;
    if (!userId) {
      setUserGroupIds([]);
      setLoading(false);
      return;
    }

    // Real-time listener for user's group memberships
    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot(
        (doc) => {
          const data = doc.data();
          const groupIds = data?.groupMemberships?.map(m => m.groupId) || [];
          setUserGroupIds(groupIds);
          setLoading(false);
        },
        (error) => {
          console.error('Error loading user groups:', error);
          setLoading(false);
        }
      );

    return () => unsubscribe();
  }, []);

  const refetch = async () => {
    const userId = auth().currentUser?.uid;
    if (!userId) return;

    const doc = await firestore().collection('users').doc(userId).get();
    const groupIds = doc.data()?.groupMemberships?.map(m => m.groupId) || [];
    setUserGroupIds(groupIds);
  };

  return (
    <GroupContext.Provider value={{ userGroupIds, loading, refetch }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroups() {
  const context = useContext(GroupContext);
  if (!context) {
    throw new Error('useGroups must be used within GroupProvider');
  }
  return context;
}
```

### Query Hook for Shared Resources

```typescript
// src/hooks/useSharedTransactions.ts
import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useGroups } from '../contexts/GroupContext';

export function useSharedTransactions(limit: number = 100) {
  const { userGroupIds, loading: groupsLoading } = useGroups();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (groupsLoading) return;

    const userId = auth().currentUser?.uid;
    if (!userId) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    // Query shared transactions (in groups)
    let sharedQuery = null;
    if (userGroupIds.length > 0) {
      sharedQuery = firestore()
        .collection('transactions')
        .where('groupId', 'in', userGroupIds.slice(0, 10))  // Max 10
        .orderBy('date', 'desc')
        .limit(limit);
    }

    // Query private transactions
    const privateQuery = firestore()
      .collection('transactions')
      .where('userId', '==', userId)
      .where('groupId', '==', null)
      .orderBy('date', 'desc')
      .limit(limit);

    // Subscribe to both queries
    const unsubscribers = [];

    if (sharedQuery) {
      const unsubShared = sharedQuery.onSnapshot((snapshot) => {
        const shared = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Also get private transactions
        privateQuery.get().then((privateSnapshot) => {
          const priv = privateSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          setTransactions([...shared, ...priv]);
          setLoading(false);
        });
      });
      unsubscribers.push(unsubShared);
    } else {
      const unsubPrivate = privateQuery.onSnapshot((snapshot) => {
        const priv = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setTransactions(priv);
        setLoading(false);
      });
      unsubscribers.push(unsubPrivate);
    }

    return () => unsubscribers.forEach(unsub => unsub());
  }, [userGroupIds, groupsLoading, limit]);

  return { transactions, loading };
}
```

### Permission Check Hooks

```typescript
// src/hooks/usePermissions.ts
import { useMemo } from 'react';
import auth from '@react-native-firebase/auth';
import { useGroups } from '../contexts/GroupContext';

export function useCanEdit(resourceUserId: string, resourceGroupId: string | null) {
  const { userGroupIds } = useGroups();
  const currentUserId = auth().currentUser?.uid;

  return useMemo(() => {
    // Owner can always edit
    if (currentUserId === resourceUserId) return true;

    // If resource is private, only owner can edit
    if (!resourceGroupId) return false;

    // If resource is in a group the user belongs to
    if (userGroupIds.includes(resourceGroupId)) {
      // TODO: Check user's role in the group (viewer vs editor)
      // For now, assume all group members can edit
      return true;
    }

    return false;
  }, [currentUserId, resourceUserId, resourceGroupId, userGroupIds]);
}

export function useIsViewer(groupId: string | null) {
  // TODO: Implement when groups collection exists
  // For now, return false (no viewer-only restriction)
  return false;
}
```

---

## Future Implementation

### Phase 1: Groups Collection (TODO)

Create the `groups` collection and implement CRUD operations:

```typescript
// Cloud Functions to implement:
- createGroup(name, description, settings)
- updateGroup(groupId, updates)
- deleteGroup(groupId)
- getGroup(groupId)
- listUserGroups(userId)
```

### Phase 2: Group Invitations (TODO)

Implement invitation system:

```typescript
// Collections to create:
- group_invitations (pending invites)

// Cloud Functions to implement:
- inviteUserToGroup(groupId, email, role)
- acceptGroupInvitation(invitationId)
- declineGroupInvitation(invitationId)
- listPendingInvitations(userId)
```

### Phase 3: Member Management (TODO)

Implement member role management:

```typescript
// Cloud Functions to implement:
- addGroupMember(groupId, userId, role)
- removeGroupMember(groupId, userId)
- updateMemberRole(groupId, userId, newRole)
- transferOwnership(groupId, newOwnerId)
- leaveGroup(groupId)
```

### Phase 4: Role-Based Permissions (TODO)

Enforce role-based permissions in security rules:

```javascript
// Update security rules to check roles:
function canEditResource(resourceGroupId) {
  let role = getUserRoleInGroup(resourceGroupId);
  return role in ['owner', 'admin', 'editor'];  // Not 'viewer'
}

function canDeleteResource(resourceGroupId) {
  let role = getUserRoleInGroup(resourceGroupId);
  return role in ['owner', 'admin'];  // Not 'editor' or 'viewer'
}
```

### Phase 5: Migration (TODO)

Migrate legacy data:

```typescript
// Migration script to implement:
- Create groups from existing familyId values
- Migrate family members to group members
- Clean up accessibleBy arrays (if any remain)
- Update all resources with correct groupId
```

### Phase 6: Frontend UI (TODO)

Build group management screens:

```typescript
// Screens to implement:
- GroupListScreen - List all user's groups
- GroupDetailScreen - View group members and settings
- CreateGroupScreen - Create new group
- InviteMemberScreen - Invite users to group
- ManageMembersScreen - Edit member roles
- GroupInvitationsScreen - View pending invitations
```

---

## Summary

This architecture provides:

✅ **Security**: Real-time access control, instant revocation, no stale data
✅ **Performance**: Efficient queries with groupId, minimal writes on membership changes
✅ **Scalability**: O(1) membership updates, not O(n) document updates
✅ **Flexibility**: Role-based permissions, per-resource overrides (future)
✅ **Simplicity**: Single source of truth, consistent patterns across all resources

The foundation is now in place. When ready to implement full group management, follow the **Future Implementation** roadmap above.
