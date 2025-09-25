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
- Firebase Cloud Functions
- TypeScript
- Firestore database
- Firebase Authentication

### Key Directories
- `src/functions/` - Cloud function implementations
  - `auth/` - Authentication functions
  - `budgets/` - Budget management functions
  - `families/` - Family management functions
  - `transactions/` - Transaction processing functions
  - `users/` - User management functions
- `src/utils/` - Utility functions (auth, firestore, validation)
- `src/types/` - TypeScript type definitions
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

### User Authentication & Profile System

#### Automatic User Profile Creation
- When a user creates an account via Firebase Authentication, a Cloud Function (`createUserProfile`) automatically triggers
- Creates a comprehensive user document in the `users` collection with:
  - Basic profile info (email, displayName, photoURL)
  - Default role (viewer) that can be updated when joining/creating families
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
- Node.js and npm
- React Native CLI
- Firebase CLI
- Xcode (for iOS development)
- Android Studio (for Android development)

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

**plaid_accounts** - Connected Bank Accounts
```typescript
interface PlaidAccount {
  accountId: string; // Plaid account_id
  itemId: string; // Reference to plaid_items
  userId: string; // Family Finance user ID
  name: string; // Account name from institution
  type: PlaidAccountType; // depository, credit, loan, etc.
  subtype: PlaidAccountSubtype; // checking, savings, etc.
  balances: PlaidAccountBalances; // Current balance info
  isActive: boolean; // Whether to include in sync
  isSyncEnabled: boolean; // Whether to sync transactions
  lastSyncedAt?: Timestamp;
}
```

**plaid_transactions** - Bank Transactions
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
   - Decrypt access token for API calls
   - Fetch new/updated transactions from Plaid
   - Store raw Plaid transactions in `plaid_transactions`
   - Process transactions into Family Finance format
   - Update sync cursors and timestamps

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

// Plaid Transactions - Strict user isolation
match /plaid_transactions/{transactionId} {
  allow read: if isOwner(resource.data.userId) || 
                 inSameFamily(resource.data.familyId);
  allow create: if false; // Only cloud functions
  allow update: if isOwner(resource.data.userId) && 
                   isValidPlaidTransactionUpdate();
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
- `/src/utils/plaidSecurity.ts` - Encryption and webhook verification
- `/src/utils/plaidSync.ts` - Webhook processing and transaction sync

**Key Functions:**
- `encryptAccessToken()` - Secure token storage
- `verifyWebhookSignature()` - Webhook security validation
- `processPlaidWebhook()` - Real-time event processing
- `syncTransactionsForUser()` - Manual and scheduled sync

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