# Scripts Directory

This directory contains utility scripts for development and data management.

## inspect-firestore.js — READ-ONLY live Firestore inspector

Prints documents from the **live** project (`family-budget-app-cb59b`). It only
ever reads (`get`/`where`/`limit`/`orderBy`/`select`/`count`) — there is no
write path in the file. Useful for verifying real state after driving the app.

**Setup (one-time):** Firebase Console → Project Settings → Service Accounts →
*Generate new private key*, then save to `~/google-service-account-key.json`
(or set `GOOGLE_APPLICATION_CREDENTIALS`). The key is gitignored and must never
be committed.

```bash
# query a collection
node scripts/inspect-firestore.js <collection> [options]

# options:
#   --id <docId>              fetch one document
#   --where <field><op><val>  filter (op: == != > >= < <=; bare "=" means ==), repeatable
#   --limit <n>               max docs (default 20)
#   --order <field[:desc]>    order by a field
#   --select <f1,f2>          only print these fields
#   --count                   print match count only
#   --json                    raw JSON (default: pretty, Timestamps → ISO)

# examples:
node scripts/inspect-firestore.js accounts --where userId=<uid> --limit 10
node scripts/inspect-firestore.js transactions --where accountId=<acct> --where isHidden=true --count
node scripts/inspect-firestore.js plaid_items --id <docId>
```

> ⚠️ This points at the **live** database (dev and prod are the same project).
> Reads are safe; do not add write operations here. For write/integration
> testing use the emulator (`firebase emulators:exec --only firestore ...`).

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
