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