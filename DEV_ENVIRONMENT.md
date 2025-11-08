# Development Environment Setup Guide

## Overview

This guide explains how to use the local development environment with Firebase Emulators for rapid iteration without deploying to production.

## Benefits

✅ **Instant Feedback**: Changes reflect in seconds, not minutes
✅ **Zero Production Risk**: Test safely without touching live data
✅ **Free Development**: No Firebase usage costs for local testing
✅ **Offline Support**: Work without internet connection
✅ **iOS Simulator Support**: Connect directly to localhost emulators
✅ **Easy Deployment**: One command to promote to production

## Setup (One-Time)

### 1. Copy Environment Files

**Backend (Cloud Functions):**
```bash
cd FamilyFinance-CloudFunctions
cp .env.development.example .env.development
cp .env.production.example .env.production

# Edit .env.development and .env.production with your actual values
```

**Frontend (Mobile App):**
```bash
cd FamilyFinanceMobile
cp .env.development.example .env.development
cp .env.production.example .env.production

# For most development, .env.development works as-is
# .env.production can stay empty (defaults to production Firebase)
```

### 2. Install Dependencies (if not already done)

```bash
cd FamilyFinanceMobile
npm install
```

### 3. Configure react-native-config (iOS)

```bash
cd FamilyFinanceMobile/ios
pod install
cd ..
```

## Daily Development Workflow

### Option 1: Full Local Development (Recommended)

**Terminal 1 - Start Firebase Emulators:**
```bash
cd FamilyFinance-CloudFunctions
npm run emulator
```

This starts:
- 🔐 Auth Emulator (port 9099)
- 📦 Firestore Emulator (port 8080)
- ⚡ Functions Emulator (port 5001)
- 🖥️  Emulator UI (http://localhost:4000)

**Terminal 2 - Start Metro Bundler:**
```bash
cd FamilyFinanceMobile
npm run start:dev
```

**Terminal 3 - Run iOS Simulator:**
```bash
cd FamilyFinanceMobile
npm run ios:dev
```

**Result**: iOS app connects to local emulators. Changes to Cloud Functions auto-reload!

### Option 2: Watch Mode (Auto-rebuild)

For even faster iteration:

**Terminal 1 - Emulators with Watch:**
```bash
cd FamilyFinance-CloudFunctions
npm run dev  # Starts emulators + TypeScript watch mode
```

Now TypeScript changes automatically rebuild!

## Available npm Scripts

### Backend (Cloud Functions)

```bash
# Local Development
npm run emulator          # Start emulators with data persistence
npm run emulator:clean    # Start fresh emulators (no saved data)
npm run dev              # Emulators + TypeScript watch mode

# Deployment
npm run prod:deploy      # Deploy to production
npm run dev:deploy       # Deploy to dev Firebase project (future)

# Utilities
npm run build            # Build TypeScript
npm run logs            # View production logs
```

### Frontend (Mobile App)

```bash
# Development (with emulators)
npm run ios:dev          # Run iOS with .env.development
npm run android:dev      # Run Android with .env.development
npm run start:dev        # Metro bundler with dev environment

# Production (real Firebase)
npm run ios:prod         # Run iOS with .env.production
npm run android:prod     # Run Android with .env.production
npm run start:prod       # Metro bundler with prod environment

# Standard
npm run ios             # Default iOS (uses production)
npm run android         # Default Android (uses production)
npm run start          # Default Metro (uses production)
```

## Testing the Nuke Button (Current Work)

Perfect use case for emulators!

**Setup Test Data:**
```bash
# Terminal 1: Start emulators
cd FamilyFinance-CloudFunctions
npm run emulator

# Terminal 2: In Emulator UI (http://localhost:4000)
# - Go to Firestore tab
# - Manually create test outflows/outflow_periods with ownerId field
# OR import sample data (see Data Management section)
```

**Test the Function:**
```bash
# Terminal 3: Run iOS app with emulators
cd FamilyFinanceMobile
npm run ios:dev

# In the app:
# - Go to Settings
# - Tap "Nuclear Cleanup"
# - Check emulator logs for detailed output!
```

**View Logs:**
- Emulator UI: http://localhost:4000 → Logs tab
- Or check Terminal 1 where emulators are running

## Data Management

### Save Emulator Data

When you have good test data:
```bash
# Emulators must be running
cd FamilyFinance-CloudFunctions
npm run emulator:export
```

Data saves to `./emulator-data/` directory.

### Load Saved Data

```bash
cd FamilyFinance-CloudFunctions
npm run emulator  # Automatically imports from ./emulator-data/
```

### Fresh Start

```bash
cd FamilyFinance-CloudFunctions
npm run emulator:clean  # Deletes saved data and starts fresh
```

## Emulator UI Features

Visit http://localhost:4000 while emulators are running:

- **📊 Overview**: See all running emulators
- **🔐 Authentication**: View/create test users
- **📦 Firestore**: Browse/edit database directly
- **⚡ Functions**: View function logs in real-time
- **📝 Logs**: Unified log view across all services

## Troubleshooting

### iOS Simulator Can't Connect to Emulators

**Check**:
```bash
# 1. Are emulators running?
# Visit http://localhost:4000 in browser

# 2. Is .env.development configured?
cat FamilyFinanceMobile/.env.development

# 3. Check app logs for Firebase initialization
# Look for: "🔧 [Firebase] Connecting to Local Emulators..."
```

**Solution**:
```bash
# Restart everything:
# Terminal 1: Ctrl+C, then npm run emulator
# Terminal 2: Ctrl+C, then npm run start:dev
# Terminal 3: Ctrl+C, then npm run ios:dev
```

### Changes Not Reflecting

**TypeScript Changes (Backend)**:
```bash
# Use watch mode:
npm run dev  # Auto-rebuilds on changes
```

**React Native Changes (Frontend)**:
```bash
# Reload in simulator:
# iOS: Cmd+R
# Android: Double-tap R
```

**Cloud Function Changes**:
- Functions reload automatically when using `npm run dev`
- If not, restart emulators

### Port Already in Use

```bash
# Kill processes on emulator ports:
lsof -ti:4000,5001,8080,9099 | xargs kill -9

# Then restart emulators:
npm run emulator
```

## Deploying to Production

When everything works in local emulators:

```bash
cd FamilyFinance-CloudFunctions
npm run prod:deploy
```

That's it! Same code, production target.

## Environment Variables

### Required for Development

**Backend (.env.development)**:
- `PLAID_CLIENT_ID` - Your Plaid sandbox client ID
- `PLAID_SECRET` - Your Plaid sandbox secret
- `TOKEN_ENCRYPTION_KEY` - 64-character hex string
- `ENVIRONMENT=development`
- `USE_EMULATOR=true`

**Frontend (.env.development)**:
- `FIREBASE_USE_EMULATOR=true`
- Emulator hosts/ports (defaults work for most setups)

### Optional for Production

**Backend (.env.production)**:
- Same as dev, but with production Plaid credentials
- `ENVIRONMENT=production`
- `USE_EMULATOR=false`

**Frontend (.env.production)**:
- `FIREBASE_USE_EMULATOR=false`
- `API_ENV=production`

## Best Practices

1. **Always test in emulators first** before deploying to production
2. **Export emulator data** when you have good test scenarios
3. **Use descriptive test data** (e.g., user email: test@example.com)
4. **Check emulator logs** for debugging (http://localhost:4000)
5. **Commit .example files**, not actual .env files (git-ignored)

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run emulator` | Start all Firebase emulators |
| `npm run ios:dev` | Run iOS with emulators |
| `npm run android:dev` | Run Android with emulators |
| `npm run prod:deploy` | Deploy to production |
| http://localhost:4000 | Emulator UI dashboard |

## Next Steps

1. ✅ Start emulators: `npm run emulator`
2. ✅ Run app: `npm run ios:dev`
3. ✅ Make changes and see instant updates!
4. ✅ When ready: `npm run prod:deploy`

Happy coding! 🚀
