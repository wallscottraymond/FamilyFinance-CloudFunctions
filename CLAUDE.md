# FamilyFinance Project - Claude AI Assistant Guide

## Project Structure

This is a full-stack React Native family finance application with Firebase backend:

```
FamilyFinance/
├── FamilyFinance-CloudFunctions/     # Firebase Cloud Functions (Backend)
└── FamilyFinanceMobile/              # React Native App (Frontend)
```

## Backend (FamilyFinance-CloudFunctions/)

### Technology Stack
- Firebase Cloud Functions (2nd generation, Node.js 20)
- TypeScript
- Firestore database
- Firebase Authentication

### Key Directories
- `src/functions/` - Cloud function implementations
  - `auth/` - Authentication functions
  - `budgets/` - Budget management functions
  - `families/` - Family management functions (DEPRECATED - being replaced by groups)
  - `groups/` - Group management functions (NEW)
  - `sharing/` - Resource sharing functions (NEW)
  - `transactions/` - Transaction processing functions
  - `users/` - User management functions
- `src/utils/` - Utility functions (auth, firestore, validation)
- `src/types/` - TypeScript type definitions
  - `index.ts` - Main types export and legacy types
  - `users.ts` - User roles, system roles, demo accounts (NEW)
  - `groups.ts` - Group system types and API interfaces (NEW)
  - `sharing.ts` - Resource sharing types and permissions (NEW)
- `src/middleware/` - CORS and other middleware

### Development Commands
```bash
cd FamilyFinance-CloudFunctions
npm run dev        # Start local development server
npm run build      # Build TypeScript
npm run deploy     # Deploy to Firebase
```

## Frontend (FamilyFinanceMobile/)

### Technology Stack
- React Native
- TypeScript
- React Navigation
- Firebase SDK (@react-native-firebase)
- React Native Gesture Handler
- React Native Screens
- React Native Safe Area Context

### Key Directories
- `src/screens/` - App screens organized by navigation pattern
  - `tabs/` - Tab navigator screens (Home, Accounts, Bills, Budgets, Goals)
  - `drawer/` - Drawer navigator screens (Profile, Notifications)
- `src/navigation/` - Navigation configuration
- `src/contexts/` - React contexts (AuthContext, SimpleAuthContext)
- `src/components/` - Reusable components (CustomDrawer, CustomHeader)
- `src/services/` - API services and authentication
- `src/types/` - TypeScript type definitions

### Development Commands
```bash
cd FamilyFinanceMobile
npm install        # Install dependencies
npm start          # Start Metro bundler
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
```

## Firebase Configuration

- Project uses Firebase Authentication, Firestore, and Cloud Functions
- Configuration files: `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`
- Google Services configuration files are present for both platforms
- Comprehensive security rules implemented for all collections
- Optimized Firestore indexes for efficient queries

## RBAC & Group-Based Sharing System (NEW - 2025-01)

### Overview

The application now implements a comprehensive Role-Based Access Control (RBAC) system with flexible group-based sharing, replacing the previous family-centric model.

### System Architecture

#### Three-Layer Permission Model

1. **System Roles** - App-wide capabilities
2. **Group Roles** - Per-group permissions
3. **Resource Roles** - Per-resource access control

### System Roles

Users are assigned ONE system-level role that determines their overall capabilities:

```typescript
enum SystemRole {
  ADMIN = "admin",              // Full access including developer settings
  POWER_USER = "power_user",    // Full access except developer settings
  STANDARD_USER = "standard_user", // Cannot add Plaid accounts
  DEMO_USER = "demo_user"       // View-only access to demo account
}
```

#### System Role Capabilities Matrix

| Capability | Admin | Power User | Standard User | Demo User |
|-----------|-------|------------|---------------|-----------|
| Add Plaid Accounts | ✓ | ✓ | ❌ | ❌ |
| Developer Settings | ✓ | ❌ | ❌ | ❌ |
| Create Budgets | ✓ | ✓ | ✓ | ❌ |
| Create Transactions | ✓ | ✓ | ✓ | ❌ |
| Share Resources | ✓ | ✓ | ✓ | ❌ |
| Join/Create Groups | ✓ | ✓ | ✓ | ❌ |

### Groups System (Replaces Families)

#### Group Structure

```typescript
interface Group {
  id: string;
  name: string;
  description?: string;
  createdBy: string;          // Original creator
  ownerId: string;            // Current owner (transferable)
  members: GroupMember[];
  settings: GroupSettings;
  isActive: boolean;
}
```

#### Group Roles

```typescript
enum GroupRole {
  OWNER = "owner",      // Full control of group
  ADMIN = "admin",      // Full control except owner removal/group deletion
  EDITOR = "editor",    // Can edit shared resources, not manage members
  VIEWER = "viewer"     // Read-only, can leave notes
}
```

### Resource Sharing System

#### Shareable Resources

All major resources support sharing:
- Budgets & Budget Periods
- Transactions
- Accounts (Plaid)
- Outflows & Outflow Periods
- Inflows & Inflow Periods

#### Resource Sharing Structure

```typescript
interface ResourceSharing {
  isShared: boolean;
  sharedWith: ResourceShare[];
  inheritPermissions: boolean;  // For period resources
}

interface ResourceShare {
  type: 'group' | 'user';      // Share with group or individual
  targetId: string;             // Group ID or User ID
  role: ResourceRole;           // owner, editor, viewer
  sharedBy: string;             // Who created the share
  sharedAt: Timestamp;
  permissions?: {
    canEdit: boolean;
    canDelete: boolean;
    canReshare: boolean;
    canViewDetails: boolean;    // For accounts: hide balances
  };
}
```

#### Permission Inheritance

Period-based resources inherit permissions from their parent:
- `budget_periods` inherit from `budgets`
- `outflow_periods` inherit from `outflows`
- `inflow_periods` inherit from `inflows`

Can be overridden at individual period level if needed.

### Demo Accounts

```typescript
interface DemoAccount {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  allowedDemoUsers: string[];  // User IDs with demo_user role
  createdBy: string;
  sampleDataGenerated: boolean;
}
```

Demo users have read-only access to their assigned demo account for product demonstration purposes.

### Migration from Families

#### Backward Compatibility

During transition, resources support both old and new systems:

```typescript
interface Budget {
  // NEW SYSTEM
  createdBy: string;
  ownerId: string;
  sharing: ResourceSharing;

  // LEGACY (deprecated)
  familyId?: string;           // For backward compatibility
  userId?: string;             // Use ownerId instead
  memberIds?: string[];        // Use sharing.sharedWith
  isShared?: boolean;          // Use sharing.isShared
}
```

#### Migration Strategy

1. **Phase 1**: Add new fields (non-breaking)
2. **Phase 2**: Populate new fields from existing data
3. **Phase 3**: Update security rules to support both
4. **Phase 4**: Migrate frontend to use new fields
5. **Phase 5**: Deprecate old fields (marked for future removal)

## Group-Based Access Control Implementation (IMPLEMENTED - 2025-01-29)

### Architecture Overview

The application now uses a simplified `groupIds` array-based sharing system instead of denormalized `accessibleBy` arrays. This approach provides better security, simpler queries, and easier group management.

### Core Concepts

#### 1. GroupIds Array

Every shareable resource has a `groupIds: string[]` field that lists which groups have access to it:

```typescript
interface ResourceOwnership {
  userId: string;           // Resource owner
  groupIds: string[];       // Groups with access (EMPTY = private)
  isActive: boolean;
  createdAt: Timestamp;
}
```

**Key Points:**
- **Empty array** `[]` = Private resource (owner-only access)
- **Non-empty array** `['group1', 'group2']` = Shared with those groups
- Groups can be families, teams, or any collaborative entity
- User membership in groups determines access rights

#### 2. Security Rules Pattern

Firestore security rules check group membership for access:

```javascript
// Check if user belongs to any of the document's groups
function canAccessGroup(documentGroupIds) {
  return isAuthenticated() &&
         documentGroupIds != null &&
         documentGroupIds.size() > 0 &&
         exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
         hasAnyGroupAccess(get(/databases/$(database)/documents/users/$(request.auth.uid)).data.groupIds, documentGroupIds);
}

// Access control pattern for all resources
allow read: if isOwner(resource.data.userId) ||
               canAccessGroup(resource.data.groupIds);
```

#### 3. Document Structure Pattern

All documents follow a hybrid structure with `groupIds` at root level:

```typescript
const document = {
  // === QUERY-CRITICAL FIELDS AT ROOT ===
  userId: string;              // Owner ID (indexed)
  groupIds: string[];          // Group access (indexed for array-contains)
  isActive: boolean;           // Active status (indexed)
  createdAt: Timestamp;        // Creation time (indexed)

  // === NESTED ACCESS CONTROL OBJECT ===
  access: {
    ownerId: string;           // Resource owner
    createdBy: string;         // Original creator
    groupIds: string[];        // Duplicate for validation
    isPrivate: boolean;        // No groups = private
  },

  // === NESTED CATEGORIES OBJECT ===
  categories: {
    primary: string;
    secondary?: string;
    tags: string[];
  },

  // === NESTED METADATA OBJECT ===
  metadata: {
    source: string;            // 'manual' | 'plaid' | 'import'
    notes?: string;
    lastSyncedAt?: Timestamp;
  },

  // === NESTED RELATIONSHIPS OBJECT ===
  relationships: {
    parentId?: string;
    parentType?: string;
    linkedIds: string[];
  },

  // === RESOURCE-SPECIFIC FIELDS ===
  // ... (varies by resource type)
};
```

### Affected Collections

All major collections now support `groupIds`:

| Collection | GroupIds Support | Notes |
|-----------|------------------|-------|
| transactions | ✓ | Shared transactions visible to group members |
| budgets | ✓ | Shared budgets and collaborative planning |
| budget_periods | ✓ | Inherit from parent budget or override |
| accounts | ✓ | Plaid accounts can be shared |
| outflows | ✓ | Recurring bills shared with group |
| outflow_periods | ✓ | Bill payment tracking |
| inflows | ✓ | Income streams shared with group |
| inflow_periods | ✓ | Income period tracking |
| plaid_items | ✓ | Plaid connections shared with group |
| plaid_accounts | ✓ | Individual accounts within Plaid items |
| plaid_transactions | ✓ | Raw Plaid transaction data |

### Query Patterns

#### Query Resources by Group

```typescript
// Get all transactions for a group
const transactions = await db.collection('transactions')
  .where('groupIds', 'array-contains', groupId)
  .orderBy('date', 'desc')
  .get();

// Get active budgets for a group
const budgets = await db.collection('budgets')
  .where('groupIds', 'array-contains', groupId)
  .where('isActive', '==', true)
  .get();
```

#### Query User's Accessible Resources

```typescript
// Get all groups user belongs to
const userDoc = await db.collection('users').doc(userId).get();
const userGroupIds = userDoc.data().groupIds || [];

// Query each group's resources
for (const groupId of userGroupIds) {
  const groupTransactions = await db.collection('transactions')
    .where('groupIds', 'array-contains', groupId)
    .orderBy('date', 'desc')
    .get();
}

// Or query user's own resources
const myTransactions = await db.collection('transactions')
  .where('userId', '==', userId)
  .orderBy('date', 'desc')
  .get();
```

### Firestore Indexes

The system includes comprehensive composite indexes for efficient queries:

```json
{
  "collectionGroup": "transactions",
  "fields": [
    { "fieldPath": "groupIds", "arrayConfig": "CONTAINS" },
    { "fieldPath": "date", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "transactions",
  "fields": [
    { "fieldPath": "groupIds", "arrayConfig": "CONTAINS" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "date", "order": "DESCENDING" }
  ]
}
```

See `firestore.indexes.json` for the complete list of 26 `groupIds`-based composite indexes.

### Backend Implementation

#### Building Documents

Use utility functions from `src/utils/documentStructure.ts`:

```typescript
import {
  buildAccessControl,
  buildMetadata,
  buildCategories,
  buildRelationships
} from '../utils/documentStructure';

// Convert single groupId parameter to groupIds array
const groupIds: string[] = groupId ? [groupId] : [];

const transaction = {
  // Root-level query fields
  userId,
  groupIds,
  isActive: true,
  createdAt: Timestamp.now(),

  // Nested objects using builders
  access: buildAccessControl(userId, userId, groupIds),
  metadata: buildMetadata(userId, 'manual'),
  categories: buildCategories('expense'),
  relationships: buildRelationships(),

  // Transaction-specific fields
  amount: 100.00,
  description: 'Groceries',
  // ...
};
```

#### Cloud Functions Pattern

All Cloud Functions follow this pattern:

```typescript
export const createTransaction = onCall(async (request) => {
  const { groupId } = request.data; // Single groupId from client

  // Convert to array
  const groupIds: string[] = groupId ? [groupId] : [];

  // Build document with groupIds
  const transaction = {
    userId: request.auth.uid,
    groupIds,  // Array
    access: buildAccessControl(request.auth.uid, request.auth.uid, groupIds),
    // ...
  };

  // Log for debugging
  console.log('Document created:', {
    userId: request.auth.uid,
    groupIds,
    groupCount: groupIds.length,
    isPrivate: groupIds.length === 0
  });

  await db.collection('transactions').add(transaction);
});
```

### Backward Compatibility

The system maintains backward compatibility with legacy fields:

```typescript
interface Transaction {
  // NEW SYSTEM (primary)
  groupIds: string[];              // Array of group IDs

  // LEGACY SYSTEM (deprecated, maintained for compatibility)
  familyId?: string;               // Single family ID
  groupId?: string;                // Single group ID
  accessibleBy?: string[];         // Denormalized user ID array
}
```

**Security rules check all three:**
1. Primary: `canAccessGroup(resource.data.groupIds)`
2. Fallback 1: `inSameFamily(resource.data.familyId)`
3. Fallback 2: `request.auth.uid in resource.data.accessibleBy`

### Migration Path

To migrate existing documents to the new system:

1. **Read SHARING.md** - Complete implementation guide
2. **Run migration script** - `prepareGroupSharing.ts` (coming soon)
3. **Update frontend** - Query using `groupIds` instead of `familyId`
4. **Monitor logs** - Verify group access patterns
5. **Gradual deprecation** - Remove legacy fields after full migration

### Benefits of GroupIds System

1. **Simpler Security Rules** - Single source of truth (user's `groupIds`)
2. **No Denormalization** - No need to maintain `accessibleBy` arrays
3. **Better Performance** - Efficient array-contains queries with proper indexes
4. **Flexible Sharing** - Resources can belong to multiple groups
5. **Easier Debugging** - Clear group membership model
6. **Scalable** - Supports unlimited groups per user

### Best Practices

**DO:**
- ✓ Always use `groupIds: string[]` array (never singular `groupId`)
- ✓ Pass `groupId` (singular) from client, convert to `groupIds` (array) in backend
- ✓ Use `buildAccessControl()` to create consistent access objects
- ✓ Log `groupIds` and `groupCount` for debugging
- ✓ Check `groupIds.length === 0` to determine if resource is private

**DON'T:**
- ✗ Don't store `groupId` (singular) in documents
- ✗ Don't populate `accessibleBy` arrays (use `groupIds` instead)
- ✗ Don't use `enhanceWithGroupSharing()` (deprecated)
- ✗ Don't query by `familyId` in new code (use `groupIds`)
- ✗ Don't modify `groupIds` directly without proper validation

### Documentation References

- **SHARING.md** - Complete group-based sharing implementation guide
- **types/index.ts** - ResourceOwnership interface with `groupIds`
- **utils/documentStructure.ts** - Document builder utilities
- **firestore.rules** - Security rules with `canAccessGroup()` helper
- **firestore.indexes.json** - Composite indexes for `groupIds` queries

### User Authentication & Profile System

#### Automatic User Profile Creation
- When a user creates an account via Firebase Authentication, a Cloud Function (`createUserProfile`) automatically triggers
- Creates a comprehensive user document in the `users` collection with:
  - Basic profile info (email, displayName, photoURL)
  - Default system role (standard_user)
  - Empty groupMemberships array
  - Comprehensive user preferences with locale-aware defaults
  - Security settings and privacy controls

#### User Preferences Architecture
The system includes extensive user preference management:

**Core Preferences:**
- `currency`: User's preferred currency (auto-detected from locale)
- `locale`: Language/region settings (e.g., "en-US", "fr-FR")
- `theme`: UI theme preference ("light", "dark", "auto")

**Notification Settings:**
- Email, push, and in-app notification controls
- Granular controls for transaction alerts, budget warnings, reports
- Family invitation and goal reminder settings

**Privacy Settings:**
- Family data sharing controls
- Transaction detail visibility settings
- Data retention and analytics preferences
- Marketing communication opt-in/out

**Display Settings:**
- Date/time format preferences (locale-aware defaults)
- Number format for currency display
- Chart and visualization preferences
- Dashboard layout customization

**Accessibility Settings:**
- Font size and contrast controls
- Motion reduction and screen reader optimization
- Haptic feedback and interaction timing

**Financial Settings:**
- Default transaction categories and auto-categorization
- Round-up savings and budget preferences
- Spending limits and alert thresholds
- Account visibility controls

**Security Settings:**
- Biometric and PIN authentication
- Session timeout and auto-lock settings
- Transaction approval requirements
- Device management and 2FA settings

## Development Guidelines

### Code Style
- Use TypeScript for type safety
- Follow React Native and Firebase best practices
- Use existing component patterns and navigation structure
- Implement proper error handling and loading states

### Firebase SDK Usage - CRITICAL

**⚠️ ALWAYS use the modular SDK API (NOT the namespaced API)**

The React Native Firebase library is deprecating the namespaced API in favor of the modular SDK to match Firebase Web SDK v9+.

#### ❌ WRONG - Deprecated Namespaced API:
```typescript
import firestore from '@react-native-firebase/firestore';

// DON'T DO THIS - will show deprecation warnings
const db = firestore();
const docRef = db.collection('users').doc(userId);
const doc = await docRef.get();
```

#### ✅ CORRECT - Modular SDK API:
```typescript
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, getDocs, onSnapshot } from '@react-native-firebase/firestore';

// DO THIS instead
const db = getFirestore();
const docRef = doc(collection(db, 'users'), userId);
const docSnap = await getDoc(docRef);
```

#### Common Firestore Operations - Modular Style:

```typescript
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp
} from '@react-native-firebase/firestore';

const db = getFirestore();

// Read single document
const userRef = doc(collection(db, 'users'), userId);
const userSnap = await getDoc(userRef);
if (userSnap.exists()) {
  const userData = userSnap.data();
}

// Query collection
const q = query(
  collection(db, 'transactions'),
  where('userId', '==', userId),
  orderBy('date', 'desc'),
  limit(50)
);
const querySnapshot = await getDocs(q);
querySnapshot.forEach(doc => {
  console.log(doc.id, doc.data());
});

// Real-time listener
const unsubscribe = onSnapshot(
  doc(collection(db, 'users'), userId),
  (docSnap) => {
    if (docSnap.exists()) {
      console.log('Current data:', docSnap.data());
    }
  },
  (error) => {
    console.error('Error:', error);
  }
);

// Create document with auto-generated ID
const newDocRef = await addDoc(collection(db, 'transactions'), {
  amount: 100,
  description: 'Test',
  createdAt: Timestamp.now()
});

// Create/update document with specific ID
await setDoc(doc(collection(db, 'users'), userId), {
  name: 'John Doe',
  updatedAt: Timestamp.now()
}, { merge: true });

// Update specific fields
await updateDoc(doc(collection(db, 'users'), userId), {
  'preferences.theme': 'dark',
  updatedAt: Timestamp.now()
});

// Delete document
await deleteDoc(doc(collection(db, 'transactions'), transactionId));
```

#### Firebase Auth - Modular Style:

```typescript
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from '@react-native-firebase/auth';

const auth = getAuth();

// Sign in
const userCredential = await signInWithEmailAndPassword(auth, email, password);
const user = userCredential.user;

// Sign up
const newUser = await createUserWithEmailAndPassword(auth, email, password);

// Sign out
await signOut(auth);
```

#### Why This Matters:
1. **Deprecation Warnings** - Old API shows console warnings
2. **Future Breaking Changes** - Namespaced API will be removed in next major version
3. **Web SDK Compatibility** - Modular API matches Firebase Web SDK for easier code sharing
4. **Better Tree Shaking** - Modular imports result in smaller bundle sizes

**Migration Guide**: https://rnfirebase.io/migrating-to-v22

### File Organization
- Keep related functionality together
- Use index files for clean imports
- Follow existing naming conventions
- Place shared types in appropriate type definition files

### Testing
- Jest configuration is set up for both projects
- Test files should be placed in `__tests__/` directories
- Use appropriate testing patterns for React Native and Firebase functions

### Firestore Data Architecture

#### Users Collection (`/users/{userId}`)
- Document ID matches Firebase Auth UID for direct access
- Comprehensive user profile with preferences
- Role-based access control via custom claims
- Automatic creation via `createUserProfile` cloud function trigger

```typescript
interface User {
  email: string;
  displayName: string;
  photoURL?: string;
  familyId?: string;
  role: UserRole; // admin, parent, child, viewer
  preferences: UserPreferences; // Comprehensive preference object
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Security Rules
- Users can read/update their own profiles
- Family members can read basic profile info of other family members
- Admins can manage any user profile
- Role changes require admin privileges
- Comprehensive validation of all preference updates

#### Mobile App Integration
- `UserService` singleton for all user operations
- Real-time profile synchronization via Firestore listeners
- Type-safe interfaces shared between mobile and cloud functions
- Helper functions for preference management and user utilities

### Common Tasks

#### Adding New Screens
1. Create screen component in appropriate `src/screens/` subdirectory
2. Add navigation types in `src/types/navigation.ts`
3. Update navigator configuration in `src/navigation/`

#### Working with User Preferences
1. Import user types: `import { User, UserPreferences } from '../types/user'`
2. Use UserService for operations: `userService.updateUserPreferences(userId, updates)`
3. Subscribe to real-time updates: `userService.subscribeToUserProfile(userId, callback)`
4. Validate preferences using default constants and helper functions

#### Adding New Cloud Functions
1. Create function in appropriate `src/functions/` subdirectory
2. Export from `src/index.ts`
3. Add necessary types in `src/types/`
4. Implement validation and error handling
5. Update Firestore security rules if needed
6. Add appropriate indexes in `firestore.indexes.json`

#### Firebase Integration
- Use `@react-native-firebase` packages for mobile
- Use Firebase Admin SDK for cloud functions
- Follow Firebase security rules and best practices
- Use type-safe interfaces for all Firestore operations

## Environment Setup

Ensure you have:
- Node.js 20 LTS and npm (Cloud Functions requirement)
- React Native CLI
- Firebase CLI (v12.0.0 or later)
- Xcode (for iOS development)
- Android Studio (for Android development)

**Node.js Version Management:**
- Cloud Functions use Node.js 20 (as specified in `package.json` and `firebase.json`)
- Local development should match: use `nvm use 20` or check `.nvmrc`
- Node.js 18 will be decommissioned in October 2025

## Plaid Integration Architecture

### Overview

The Family Finance app integrates with Plaid to provide real-time bank account connectivity, automatic transaction import, and comprehensive financial data synchronization. The integration is designed with security, scalability, and user privacy as primary concerns.

### Plaid Configuration

**Client Configuration:**
- Client ID: `6439737b3f59d500139a7d13`
- Environment: Sandbox (for development)
- Products: `transactions`, `balances`
- Supported Features:
  - Real-time transaction sync
  - Account balance monitoring
  - Webhook-driven updates
  - Encrypted token storage

### Data Architecture

#### Collection Structure

**plaid_items** - Plaid Item Management
```typescript
interface PlaidItem {
  itemId: string; // Plaid item_id
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association
  institutionId: string; // Plaid institution_id
  institutionName: string; // Human-readable institution name
  institutionLogo?: string; // Institution logo URL
  accessToken: string; // ENCRYPTED Plaid access token
  cursor?: string; // For transaction sync pagination
  products: PlaidProduct[]; // Enabled products
  status: PlaidItemStatus; // Item connection status
  error?: PlaidItemError; // Current error state
  lastWebhookReceived?: Timestamp;
  isActive: boolean;
}
```

**accounts** - Connected Bank Accounts
```typescript
interface Account {
  id: string; // Document ID (same as plaidAccountId)
  plaidAccountId: string; // Plaid account_id
  accountId: string; // Alias for plaidAccountId
  itemId: string; // Reference to plaid_items
  userId: string; // Family Finance user ID
  familyId: string; // Family association
  institutionId: string; // Plaid institution_id
  institutionName: string; // Institution name
  accountName: string; // Account name from institution
  accountType: string; // depository, credit, loan, etc.
  accountSubtype: string | null; // checking, savings, etc.
  mask: string | null; // Account number mask
  officialName: string | null; // Official account name
  currentBalance: number; // Current balance (FIX: was 'balance', now 'currentBalance')
  availableBalance: number | null; // Available balance
  limit: number | null; // Credit limit for credit accounts
  isoCurrencyCode: string; // Currency code (e.g., "USD")
  isActive: boolean; // Whether to include in sync
  isSyncEnabled: boolean; // Whether to sync transactions
  lastBalanceUpdate: Timestamp; // Last balance update time
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Important Fix (2025-10-03)**: The account balance field was corrected from `balance` to `currentBalance` throughout the codebase. The backend Cloud Function in `/src/utils/plaidAccounts.ts` now correctly saves balances to `currentBalance` field to match what the mobile app reads. This fixes the issue where account balances were showing as blank when adding new Plaid accounts.

**transactions** - Bank Transactions
```typescript
interface PlaidTransaction {
  transactionId: string; // Plaid transaction_id
  accountId: string; // Reference to plaid_accounts
  itemId: string; // Reference to plaid_items
  userId: string; // Family Finance user ID
  amount: number; // Transaction amount
  category: string[]; // Plaid category hierarchy
  merchantName?: string; // Merchant name
  dateTransacted: Timestamp; // Transaction date
  datePosted: Timestamp; // Posted date
  pending: boolean; // Is transaction pending
  isProcessed: boolean; // Converted to family transaction
  familyTransactionId?: string; // Linked family transaction
  userCategory?: TransactionCategory; // User override
  userNotes?: string; // User notes
  tags: string[]; // User tags
}
```

**plaid_webhooks** - Webhook Event Tracking
```typescript
interface PlaidWebhook {
  webhookType: PlaidWebhookType;
  webhookCode: PlaidWebhookCode;
  itemId?: string; // Item-specific webhooks
  payload: Record<string, any>; // Full webhook payload
  processingStatus: PlaidWebhookProcessingStatus;
  retryCount: number;
  signature: string; // For verification
  isValid: boolean;
}
```

#### Security Architecture

**Token Encryption:**
- All Plaid access tokens are encrypted using AES-256-GCM
- Unique initialization vectors for each encryption
- Authentication tags prevent tampering
- Environment variable-based encryption keys

**Webhook Security:**
- HMAC-SHA256 signature verification
- Timing-safe signature comparison
- Request idempotency tracking
- Processing status monitoring

**Access Control:**
- Users can only access their own Plaid data
- Family members can see limited account information
- Admins have full access for troubleshooting
- Cloud functions have exclusive write access to transactions

### Transaction Synchronization

#### Real-time Webhook Processing

1. **Webhook Receipt:**
   - Signature verification using HMAC-SHA256
   - Payload validation and parsing
   - Duplicate detection and idempotency

2. **Event Processing:**
   - `SYNC_UPDATES_AVAILABLE`: Trigger transaction sync
   - `TRANSACTIONS_REMOVED`: Remove deleted transactions
   - `ITEM_ERROR`: Update item error status
   - `PENDING_EXPIRATION`: Mark item for re-authentication

3. **Transaction Sync Flow:**
   - Decrypt access token for API calls using AES-256-GCM
   - Fetch new/updated transactions from Plaid API
   - Map Plaid categories to app transaction categories (see Category Mapping section)
   - Store raw Plaid transactions in Firestore `transactions` collection
   - Process transactions into Family Finance format
   - Update sync cursors and timestamps
   - Log all operations for debugging and monitoring

#### Data Loading Strategy

**Backend Storage:**
- Store all available transaction history (configurable limit)
- Maintain transaction cursors for efficient incremental sync
- Track processing status to avoid duplicates

**Frontend Loading:**
- Load only last 30 days of transactions for performance
- Implement pagination for historical data access
- Real-time updates via Firestore listeners

#### Sync Frequency Options

- **Real-time**: Webhook-driven (preferred)
- **Scheduled**: Hourly, 6-hourly, or daily backup sync
- **Manual**: User-initiated sync for troubleshooting

### Firestore Indexes

Optimized indexes for common query patterns:

```json
// User's transactions by date
{
  "userId": "ASCENDING",
  "dateTransacted": "DESCENDING"
}

// Account-specific transactions
{
  "accountId": "ASCENDING", 
  "pending": "ASCENDING",
  "dateTransacted": "DESCENDING"
}

// Family transaction visibility
{
  "familyId": "ASCENDING",
  "isHidden": "ASCENDING", 
  "dateTransacted": "DESCENDING"
}

// Category-based queries
{
  "userId": "ASCENDING",
  "categoryId": "ASCENDING",
  "dateTransacted": "DESCENDING"
}
```

### Security Rules

```javascript
// Plaid Items - User ownership with family visibility
match /plaid_items/{itemId} {
  allow read: if isOwner(resource.data.userId) ||
                 inSameFamily(resource.data.familyId);
  allow create, update: if isOwner(request.resource.data.userId);
  allow delete: if isOwner(resource.data.userId) || isAdmin();
}

// Accounts (Connected Bank Accounts) - User ownership with family visibility
match /accounts/{accountId} {
  allow read: if isOwner(resource.data.userId) ||
                 inSameFamily(resource.data.familyId);
  allow create, update: if false; // Only cloud functions can write
  allow delete: if isOwner(resource.data.userId) || isAdmin();
}

// Transactions - User isolation with family sharing
match /transactions/{transactionId} {
  allow read: if isOwner(resource.data.userId) ||
                 inSameFamily(resource.data.familyId);
  allow create: if false; // Only cloud functions can create
  allow update: if isOwner(resource.data.userId) &&
                   isValidTransactionUpdate();
  allow delete: if isAdmin();
}
```

### Error Handling & Monitoring

**Error Categories:**
- **Item Errors**: Authentication failures, permission revocation
- **Transaction Sync Errors**: API timeouts, rate limiting
- **Webhook Processing Errors**: Invalid signatures, parsing failures

**Retry Logic:**
- Exponential backoff for API calls
- Maximum retry limits to prevent infinite loops
- Manual retry capabilities for administrators

**Monitoring:**
- Webhook processing status tracking
- Sync frequency and success rates
- Error categorization and alerting

### Integration Utilities

**Core Utilities:**
- `/src/utils/encryption.ts` - Access token encryption using AES-256-GCM
- `/src/utils/plaidAccounts.ts` - Account data retrieval and storage
- `/src/utils/syncTransactions.ts` - Transaction sync and category mapping
- `/src/functions/plaid/` - Plaid integration Cloud Functions

**Key Functions:**
- `encryptAccessToken()` - Secure token storage with AES-256-GCM
- `fetchPlaidAccounts()` - Retrieve account details from Plaid API
- `savePlaidItem()` - Save encrypted Plaid item to Firestore
- `savePlaidAccounts()` - Save account documents with correct field names (currentBalance)
- `mapPlaidCategoryToTransactionCategory()` - Map Plaid categories to app categories

### Development Setup

**Environment Variables:**
```bash
PLAID_CLIENT_ID=6439737b3f59d500139a7d13
PLAID_SECRET=your_sandbox_secret
PLAID_WEBHOOK_SECRET=your_webhook_secret
TOKEN_ENCRYPTION_KEY=64_character_hex_string
```

**Testing:**
- Sandbox environment for development
- Test webhook signatures for validation
- Mock transaction data for frontend testing

### Performance Considerations

**Optimization Strategies:**
- Batch transaction processing
- Incremental sync with cursors
- Efficient Firestore indexing
- Background processing for heavy operations

**Scaling:**
- Webhook processing can handle concurrent requests
- Transaction sync is designed for high volume
- Firestore security rules optimize for user-specific queries

### Category Mapping

**Plaid to App Category Mapping:**
The system automatically maps Plaid's category hierarchy to the app's transaction categories using `/src/utils/syncTransactions.ts`:

```typescript
// Category mappings (primary and secondary Plaid categories)
{
  'food and drink': FOOD,
  'restaurants': FOOD,
  'groceries': FOOD,
  'transportation': TRANSPORTATION,
  'gas stations': TRANSPORTATION,
  'shops': CLOTHING,
  'retail': CLOTHING,
  'entertainment': ENTERTAINMENT,
  'utilities': UTILITIES,
  'healthcare': HEALTHCARE,
  'housing': HOUSING,
  'rent': HOUSING,
  'mortgage': HOUSING,
  'payroll': SALARY,
  'deposit': OTHER_INCOME,
}
```

**Default Behavior:**
- Unmapped categories default to `OTHER_EXPENSE`
- Category matching is case-insensitive
- Checks both primary and secondary Plaid categories
- Comprehensive logging for debugging category assignments

### Privacy & Compliance

**Data Protection:**
- All sensitive tokens encrypted at rest
- User data isolation through security rules
- Configurable data retention periods
- User control over account sync settings

**Family Sharing:**
- Optional family-level transaction sharing
- Granular privacy controls per user
- Account-level visibility settings

## Budget Period Checklist System

### Overview

The Budget Period Checklist System allows users to create detailed task lists within their budget periods to track specific spending goals, categories, and financial objectives. This feature enhances budget management by providing granular tracking capabilities for individual spending items within broader budget categories.

### Architecture

#### Data Structure

**ChecklistItem Interface:**
```typescript
interface ChecklistItem {
  id: string;                   // Unique identifier for the checklist item
  name: string;                 // Display name/description
  transactionSplit: string;     // Future transaction splitting functionality (placeholder)
  expectedAmount: number;       // Budgeted/expected amount for this item
  actualAmount: number;         // Actual amount spent on this item
  isChecked: boolean;          // Completion/tracking status
}
```

**Enhanced BudgetPeriodDocument:**
```typescript
interface BudgetPeriodDocument extends BaseDocument {
  // ... existing fields ...
  budgetName: string;          // Denormalized budget name for performance
  checklistItems: ChecklistItem[]; // Array of checklist items for this period
  // ... existing fields ...
}
```

#### Cloud Functions

**Checklist Management Functions:**

1. **`addChecklistItem`** - Add new checklist item to a budget period
   - **Endpoint:** `addChecklistItem`
   - **Method:** Firebase Functions v2 Callable
   - **Authentication:** Required (user must own the budget period)
   - **Parameters:**
     ```typescript
     interface AddChecklistItemRequest {
       budgetPeriodId: string;
       checklistItem: Omit<ChecklistItem, 'id'>;
     }
     ```
   - **Response:**
     ```typescript
     interface ChecklistItemResponse {
       success: boolean;
       checklistItem?: ChecklistItem;
       message?: string;
     }
     ```

2. **`updateChecklistItem`** - Update existing checklist item
   - **Endpoint:** `updateChecklistItem`
   - **Method:** Firebase Functions v2 Callable
   - **Authentication:** Required (user must own the budget period)
   - **Parameters:**
     ```typescript
     interface UpdateChecklistItemRequest {
       budgetPeriodId: string;
       checklistItemId: string;
       updates: Partial<Omit<ChecklistItem, 'id'>>;
     }
     ```

3. **`deleteChecklistItem`** - Remove checklist item from budget period
   - **Endpoint:** `deleteChecklistItem`
   - **Method:** Firebase Functions v2 Callable
   - **Authentication:** Required (user must own the budget period)
   - **Parameters:**
     ```typescript
     interface DeleteChecklistItemRequest {
       budgetPeriodId: string;
       checklistItemId: string;
     }
     ```

4. **`toggleChecklistItem`** - Toggle checked status of checklist item
   - **Endpoint:** `toggleChecklistItem`
   - **Method:** Firebase Functions v2 Callable
   - **Authentication:** Required (user must own the budget period)
   - **Parameters:**
     ```typescript
     interface ToggleChecklistItemRequest {
       budgetPeriodId: string;
       checklistItemId: string;
     }
     ```

### Security Implementation

#### Firestore Security Rules

Enhanced budget period validation with checklist support:

```javascript
// Validate budget period updates
function isValidBudgetPeriodUpdate() {
  let data = request.resource.data;
  let resource_data = resource.data;
  
  // Allow updates to user-modifiable fields including checklist items
  let allowedFields = [
    'userNotes', 'modifiedAmount', 'isModified', 'lastModifiedBy', 
    'lastModifiedAt', 'checklistItems', 'updatedAt'
  ];
  
  let changedFields = data.diff(resource_data).affectedKeys();
  let validFieldChanges = changedFields.hasOnly(allowedFields);
  
  // Ensure core immutable fields don't change
  let coreFieldsUnchanged = data.budgetId == resource_data.budgetId &&
                           data.periodId == resource_data.periodId &&
                           data.userId == resource_data.userId;
  
  // Validate checklist items if they're being updated
  let checklistValid = !changedFields.hasAny(['checklistItems']) || 
                      isValidChecklistItems(data.checklistItems);
  
  return validFieldChanges && coreFieldsUnchanged && checklistValid;
}

// Validate checklist items array
function isValidChecklistItems(checklistItems) {
  return checklistItems is list &&
         checklistItems.size() <= 20 && // Reasonable limit
         checklistItems.all(item, isValidChecklistItem(item));
}

// Validate individual checklist item
function isValidChecklistItem(item) {
  return item is map &&
         item.keys().hasAll(['id', 'name', 'transactionSplit', 'expectedAmount', 'actualAmount', 'isChecked']) &&
         item.id is string && item.id.size() > 0 &&
         item.name is string && item.name.size() > 0 && item.name.size() <= 100 &&
         item.transactionSplit is string &&
         item.expectedAmount is number && item.expectedAmount >= 0 &&
         item.actualAmount is number && item.actualAmount >= 0 &&
         item.isChecked is bool;
}
```

#### Access Control

- **User Ownership:** Only budget period owners can modify their checklist items
- **Authentication Required:** All checklist operations require valid Firebase Auth token
- **Family Visibility:** Family members can read checklist items but cannot modify them
- **Admin Override:** System admins have full access for troubleshooting

### Usage Examples

#### Frontend Integration (React Native)

```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functions = getFunctions();

// Add checklist item
const addChecklistItem = async (budgetPeriodId: string, item: Omit<ChecklistItem, 'id'>) => {
  try {
    const addItem = httpsCallable(functions, 'addChecklistItem');
    const result = await addItem({
      budgetPeriodId,
      checklistItem: item
    });
    return result.data;
  } catch (error) {
    console.error('Error adding checklist item:', error);
    throw error;
  }
};

// Update checklist item
const updateChecklistItem = async (budgetPeriodId: string, itemId: string, updates: Partial<ChecklistItem>) => {
  try {
    const updateItem = httpsCallable(functions, 'updateChecklistItem');
    const result = await updateItem({
      budgetPeriodId,
      checklistItemId: itemId,
      updates
    });
    return result.data;
  } catch (error) {
    console.error('Error updating checklist item:', error);
    throw error;
  }
};

// Toggle checklist item
const toggleChecklistItem = async (budgetPeriodId: string, itemId: string) => {
  try {
    const toggleItem = httpsCallable(functions, 'toggleChecklistItem');
    const result = await toggleItem({
      budgetPeriodId,
      checklistItemId: itemId
    });
    return result.data;
  } catch (error) {
    console.error('Error toggling checklist item:', error);
    throw error;
  }
};

// Delete checklist item
const deleteChecklistItem = async (budgetPeriodId: string, itemId: string) => {
  try {
    const deleteItem = httpsCallable(functions, 'deleteChecklistItem');
    const result = await deleteItem({
      budgetPeriodId,
      checklistItemId: itemId
    });
    return result.data;
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    throw error;
  }
};
```

### Performance Considerations

#### Data Storage Strategy

- **Embedded Documents:** Checklist items are stored as an embedded array within budget period documents for atomic operations and better performance
- **Document Size Limits:** Maximum 20 checklist items per budget period to stay within Firestore document size limits
- **Denormalized Data:** Budget names are stored directly in budget periods to avoid additional lookups

#### Optimization Features

- **Batch Operations:** All checklist modifications update the entire array atomically
- **Client-side Caching:** Real-time subscriptions to budget periods include checklist updates
- **Minimal Network Calls:** Single function call updates entire checklist state

### Development Guidelines

#### Adding Checklist Features

1. **Follow Existing Patterns:**
   ```typescript
   // Always validate authentication
   if (!request.auth) {
     throw new HttpsError('unauthenticated', 'User must be authenticated');
   }
   
   // Verify budget period ownership
   if (budgetPeriodData.userId !== request.auth.uid) {
     throw new HttpsError('permission-denied', 'You can only modify your own budget periods');
   }
   ```

2. **Error Handling:**
   - Use Firebase Functions v2 HttpsError for consistent error responses
   - Include detailed logging for debugging
   - Validate all inputs thoroughly

3. **Testing:**
   - Test all CRUD operations for checklist items
   - Verify security rules prevent unauthorized access
   - Test with maximum checklist item limits

#### Future Enhancements

1. **Transaction Splitting Integration:**
   - The `transactionSplit` field is prepared for future functionality
   - Will allow linking checklist items to specific transaction splits
   - Enables automatic progress tracking based on actual spending

2. **Analytics Integration:**
   - Checklist completion rates by user and period
   - Budget vs actual analysis at checklist item level
   - Spending pattern identification through checklist data

3. **Mobile App Features:**
   - Drag-and-drop checklist reordering
   - Smart suggestions based on historical patterns
   - Progress indicators and completion celebrations

### Troubleshooting

#### Common Issues

1. **Permission Denied Errors:**
   - Verify user owns the budget period
   - Check Firestore security rules deployment
   - Ensure proper authentication token

2. **Validation Errors:**
   - Check checklist item field types and constraints
   - Verify maximum item limit (20 items per period)
   - Validate required fields are present

3. **Performance Issues:**
   - Monitor document size growth with many checklist items
   - Consider pagination for large lists in mobile UI
   - Use efficient Firestore listeners for real-time updates

#### Debug Commands

```bash
# Check function deployment status
firebase functions:list | grep -E "Checklist"

# View function logs
firebase functions:log --only addChecklistItem,updateChecklistItem,deleteChecklistItem,toggleChecklistItem

# Test function locally
firebase emulators:start --only functions,firestore
```

## Recent Updates and Bug Fixes

### October 3, 2025 - Account Balance Field Fix

**Issue**: Account balances were showing as blank when adding new Plaid accounts.

**Root Cause**: Field name mismatch between backend and frontend:
- Backend Cloud Function (`/src/utils/plaidAccounts.ts`) was saving balances to `balance` field
- Mobile app was reading from `currentBalance` field

**Fix Applied**:
- Updated `/src/utils/plaidAccounts.ts:137` to save to `currentBalance` field
- Standardized field name across entire codebase
- Updated all CLAUDE.md documentation files to reflect correct field name

**Files Changed**:
- `/FamilyFinance-CloudFunctions/src/utils/plaidAccounts.ts`
- `/CLAUDE.md` (main documentation)
- `/FamilyFinanceMobile/src/contexts/CLAUDE.md`
- `/FamilyFinanceMobile/src/services/CLAUDE.md`

**Testing**: Verified that new Plaid account connections now display balances correctly.

### Category Mapping Enhancement

**Enhancement**: Improved Plaid category to app category mapping with comprehensive logging.

**Implementation**: `/src/utils/syncTransactions.ts` includes detailed category mapping logic:
- Maps Plaid's hierarchical categories to app's flat transaction categories
- Case-insensitive matching on both primary and secondary Plaid categories
- Comprehensive logging for debugging category assignments
- Default fallback to `OTHER_EXPENSE` for unmapped categories

**Supported Mappings**:
- Food categories (food and drink, restaurants, groceries) → FOOD
- Transportation (gas stations) → TRANSPORTATION
- Housing (rent, mortgage) → HOUSING
- Income (payroll, deposit) → SALARY/OTHER_INCOME
- And more (see Category Mapping section for complete list)

## RBAC Implementation Status

**Status**: IN PROGRESS (~15% complete)
**Tracking Document**: `/RBAC_IMPLEMENTATION_STATUS.md`

### Completed
- ✅ Core type system (users.ts, groups.ts, sharing.ts)
- ✅ Updated User interface with system roles
- ✅ Updated Budget interface with sharing
- ✅ Backward compatibility structure

### In Progress
- 🔄 Updating remaining resource types
- 🔄 Firestore security rules
- 🔄 Cloud Functions for groups and sharing

### Not Started
- ⏸️ Mobile app type updates
- ⏸️ Mobile contexts and services
- ⏸️ Data migration scripts
- ⏸️ UI components

**For detailed progress and next steps, see** `/RBAC_IMPLEMENTATION_STATUS.md`

## Notes for AI Assistants

- Always check existing patterns before implementing new features
- Use the established project structure and conventions
- Test changes in both development environments
- Consider both mobile and cloud function impacts when making changes
- Follow Firebase security best practices
- Use TypeScript strictly - no any types without justification
- For Plaid integration, always encrypt sensitive tokens and verify webhook signatures
- Ensure proper error handling and retry logic for external API calls
- Test Plaid integration thoroughly in sandbox environment before production
- **CRITICAL**: Always use `currentBalance` field for account balances, never `balance`
- Verify field names match between backend Cloud Functions and frontend mobile app
- Reference the Category Mapping section when working with transaction categorization
- **NEW**: When working with permissions, always use the RBAC system (systemRole, groupRole, resourceRole)
- **NEW**: Support backward compatibility with familyId during migration period
- **NEW**: Check `/RBAC_IMPLEMENTATION_STATUS.md` for current implementation progress