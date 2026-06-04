/**
 * Migration script to add plaidAccountId to existing accounts
 *
 * Run with:
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/service-accounts/family-budget-app-cb59b.json
 *   node scripts/fix_account_plaid_ids.js
 *
 * Or run gcloud auth application-default login first
 */
const admin = require('firebase-admin');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Try to find Firebase service account
function getCredential() {
  // Check common locations
  const possiblePaths = [
    path.join(os.homedir(), '.config/firebase/service-accounts/family-budget-app-cb59b.json'),
    path.join(os.homedir(), '.config/gcloud/application_default_credentials.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean);

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`Using credentials from: ${p}`);
        return admin.credential.cert(require(p));
      }
    } catch (e) {
      // Continue to next option
    }
  }

  // Fall back to default credentials
  console.log('Using application default credentials');
  return admin.credential.applicationDefault();
}

admin.initializeApp({
  credential: getCredential(),
  projectId: 'family-budget-app-cb59b'
});

const db = admin.firestore();

async function fixAccountPlaidIds() {
  console.log("=".repeat(80));
  console.log("🔧 ADMIN: Fixing Account PlaidAccountIds");
  console.log("=".repeat(80));

  const accountsSnapshot = await db.collection("accounts").get();

  const missingPlaidIds = [];
  let alreadyHasPlaidId = 0;
  let noAccountId = 0;

  accountsSnapshot.forEach(doc => {
    const data = doc.data();

    if (data.plaidAccountId) {
      alreadyHasPlaidId++;
      return;
    }

    if (!data.accountId) {
      console.warn(`   ⚠️ Account ${doc.id} has no accountId field`);
      noAccountId++;
      return;
    }

    missingPlaidIds.push({
      id: doc.id,
      accountId: data.accountId,
      name: data.name || data.accountName || "Unknown"
    });
  });

  console.log(`Total accounts: ${accountsSnapshot.size}`);
  console.log(`Already have plaidAccountId: ${alreadyHasPlaidId}`);
  console.log(`Missing plaidAccountId (will fix): ${missingPlaidIds.length}`);
  console.log(`Missing accountId (cannot fix): ${noAccountId}`);

  if (missingPlaidIds.length === 0) {
    console.log("\n✅ No accounts need fixing");
    process.exit(0);
  }

  // Batch update
  const BATCH_SIZE = 500;
  let fixed = 0;

  for (let i = 0; i < missingPlaidIds.length; i += BATCH_SIZE) {
    const batchAccounts = missingPlaidIds.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const account of batchAccounts) {
      const ref = db.collection("accounts").doc(account.id);
      batch.update(ref, {
        plaidAccountId: account.accountId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`   ✓ ${account.name} -> plaidAccountId: ${account.accountId}`);
      fixed++;
    }

    await batch.commit();
  }

  console.log("\n" + "=".repeat(80));
  console.log(`✅ Fixed ${fixed} accounts`);
  console.log("=".repeat(80));

  process.exit(0);
}

fixAccountPlaidIds().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
