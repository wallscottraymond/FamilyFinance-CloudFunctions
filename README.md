# FamilyFinance Cloud Functions

Firebase Cloud Functions backend for the FamilyFinance mobile application, providing secure serverless functions for family financial management.

## 🚀 Features

### Core Functionality
- **User Management**: Authentication, profile management, role-based access control
- **Family Management**: Create/join families, invite members, role management
- **Transaction Management**: Create, update, approve/reject transactions with real-time updates
- **Budget Management**: Create budgets, track spending, alerts and notifications
- **Security**: Firebase Auth integration, custom claims, permission validation

### Technical Features
- **TypeScript**: Full type safety and modern JavaScript features
- **Firestore**: Optimized NoSQL database operations with compound indexes
- **Real-time**: WebSocket connections for live updates
- **Validation**: Comprehensive request validation using Joi
- **Error Handling**: Structured error responses and logging
- **CORS**: Configurable cross-origin resource sharing

## 📁 Project Structure

```
src/
├── functions/
│   ├── auth/           # Authentication functions
│   ├── users/          # User management functions
│   ├── families/       # Family management functions
│   ├── transactions/   # Transaction CRUD operations
│   └── budgets/        # Budget management functions
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
│   ├── firestore.ts   # Firestore helpers
│   ├── auth.ts        # Authentication helpers
│   └── validation.ts  # Request validation schemas
├── middleware/         # Express middleware
├── config/            # Configuration constants
└── index.ts          # Main entry point
```

## 🛠️ Setup & Installation

### Prerequisites
- Node.js 18 or higher
- Firebase CLI
- Firebase project with Firestore enabled

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Firebase**:
   ```bash
   # Login to Firebase
   firebase login
   
   # Set your project ID in .firebaserc
   firebase use --add your-firebase-project-id
   ```

3. **Set up environment**:
   ```bash
   # Copy environment template (if you create one)
   cp .env.example .env
   ```

### Development

1. **Build TypeScript**:
   ```bash
   npm run build
   ```

2. **Start Firebase emulators**:
   ```bash
   npm run serve
   ```

3. **Watch mode (recommended for development)**:
   ```bash
   npm run dev
   ```

### Deployment

1. **Deploy to Firebase**:
   ```bash
   npm run deploy
   ```

2. **Deploy specific functions**:
   ```bash
   firebase deploy --only functions:functionName
   ```

## 🔧 Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run build:watch` - Watch for changes and compile
- `npm run serve` - Start Firebase emulators
- `npm run dev` - Development mode (watch + emulators)
- `npm run deploy` - Deploy to Firebase
- `npm run logs` - View function logs
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run test` - Run tests (when implemented)

## 📝 API Documentation

### Authentication
All functions require Firebase Auth ID token in Authorization header:
```
Authorization: Bearer <firebase-id-token>
```

### Function Endpoints

#### User Management
- `POST /createUserProfile` - Create user profile (triggered automatically)
- `GET /getUserProfile` - Get user profile
- `PUT /updateUserProfile` - Update user profile
- `DELETE /deleteUserAccount` - Delete user account
- `GET /getUserStatistics` - Get user spending statistics

#### Family Management
- `POST /createFamily` - Create new family
- `GET /getFamily` - Get family details and members
- `PUT /updateFamily` - Update family settings (admin only)
- `POST /generateFamilyInvite` - Generate invite code
- `POST /joinFamily` - Join family with invite code
- `POST /leaveFamily` - Leave current family
- `DELETE /removeFamilyMember` - Remove family member (admin only)

#### Transaction Management
- `POST /createTransaction` - Create new transaction
- `GET /getTransaction` - Get transaction by ID
- `PUT /updateTransaction` - Update transaction
- `DELETE /deleteTransaction` - Delete transaction
- `GET /getUserTransactions` - Get user's transactions
- `GET /getFamilyTransactions` - Get all family transactions
- `POST /approveTransaction` - Approve/reject transaction

#### Budget Management
- `POST /createBudget` - Create new budget
- `GET /getBudget` - Get budget by ID
- `PUT /updateBudget` - Update budget
- `DELETE /deleteBudget` - Delete budget (soft delete)
- `GET /getFamilyBudgets` - Get all family budgets
- `GET /getUserBudgets` - Get user's budgets
- `GET /getBudgetSummary` - Get budget spending summary

#### Authentication
- `POST /refreshUserSession` - Refresh user session and claims
- `PUT /updateUserRole` - Update user role (admin only)
- `POST /transferFamilyAdmin` - Transfer admin role
- `POST /validateToken` - Validate auth token
- `GET /getUserPermissions` - Get user permissions

### Response Format
All functions return standardized responses:

**Success Response:**
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2023-12-08T10:30:00.000Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "error-code",
    "message": "Error description",
    "details": { ... }
  },
  "timestamp": "2023-12-08T10:30:00.000Z"
}
```

## 🔒 Security

### Role-Based Access Control
- **ADMIN**: Full access to family data and settings
- **PARENT**: Can create budgets, approve transactions, view all family data
- **CHILD**: Can create transactions (subject to approval), view own data
- **VIEWER**: Read-only access to own data

### Permission Validation
- All functions validate user permissions
- Family-scoped data access controls
- Custom Firebase Auth claims for role enforcement

### Data Validation
- Joi schemas for all request validation
- Input sanitization and type checking
- Business logic validation (budget limits, etc.)

## 🗄️ Database Schema

### Collections
- `users` - User profiles and preferences
- `families` - Family information and settings
- `transactions` - Financial transactions
- `budgets` - Budget definitions and tracking
- `notifications` - User notifications (future)

### Key Relationships
- Users belong to one family
- Transactions are scoped to families
- Budgets are shared within families
- Role-based access controls apply to all operations

## 🔨 Development Guidelines

### Code Style
- Use TypeScript strict mode
- Follow ESLint configuration
- Use async/await for async operations
- Implement proper error handling

### Testing
- Write unit tests for utility functions
- Integration tests for Firebase operations
- Mock Firebase services in tests

### Performance
- Optimize Firestore queries with indexes
- Use batch operations when appropriate
- Implement caching where beneficial
- Monitor function execution times

## 🚀 Deployment

### Environment Variables
Set these in Firebase Functions config:
```bash
firebase functions:config:set app.name="FamilyFinance"
firebase functions:config:set app.support_email="support@example.com"
```

### Required Firebase Features
- Authentication
- Firestore Database
- Cloud Functions
- (Optional) Firebase Hosting for admin dashboard

### Firestore Indexes
Create composite indexes for:
- `transactions`: `familyId`, `userId`, `date`
- `transactions`: `familyId`, `status`, `date`
- `budgets`: `familyId`, `isActive`, `createdAt`
- `budgets`: `familyId`, `memberIds`, `isActive`

## 📊 Monitoring

### Logs
View logs with:
```bash
npm run logs
# or
firebase functions:log
```

### Error Tracking
- All errors are logged with context
- Use Firebase Console for monitoring
- Consider integrating error tracking service

## 🤝 Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all linting passes
5. Test with Firebase emulators

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
- Create GitHub issues for bugs
- Check Firebase documentation
- Review function logs for debugging
- Use Firebase emulators for local testing