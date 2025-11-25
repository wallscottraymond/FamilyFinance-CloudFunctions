# Scripts Directory

This directory contains utility scripts for development and data management.

## Available Scripts (Coming Soon)

### seedEmulatorData.js
Seeds the Firebase emulators with test data for development.

Usage:
```bash
cd FamilyFinance-CloudFunctions
node scripts/seedEmulatorData.js
```

### cloneProductionData.js
Clones production data to development environment (use with caution).

Usage:
```bash
cd FamilyFinance-CloudFunctions
node scripts/cloneProductionData.js
```

## Creating Your Own Scripts

Scripts can interact with Firebase using the Admin SDK. Example structure:

```javascript
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  projectId: 'family-budget-app-cb59b' // or dev project
});

const db = admin.firestore();

async function yourScript() {
  // Your logic here
}

yourScript().catch(console.error);
```

## Notes

- Scripts run locally, not as Cloud Functions
- Always test scripts with emulators first before running on production
- Keep sensitive data out of version control
