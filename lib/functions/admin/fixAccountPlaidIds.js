"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixAccountPlaidIds = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * ADMIN: Fix Account PlaidAccountIds
 *
 * This function fixes accounts that are missing the plaidAccountId field.
 * The plaidAccountId should be the same as the accountId field.
 *
 * This is needed because:
 * 1. The new architecture's upsert_from_plaid was not saving plaidAccountId
 * 2. The mobile app uses plaidAccountId to filter transactions
 * 3. Without plaidAccountId, clicking on an account shows no transactions
 *
 * Usage:
 * firebase functions:call fixAccountPlaidIds
 */
exports.fixAccountPlaidIds = (0, https_1.onCall)(async () => {
    console.log("=".repeat(80));
    console.log("🔧 ADMIN: Fixing Account PlaidAccountIds");
    console.log("=".repeat(80));
    try {
        // Step 1: Find all accounts missing plaidAccountId but have accountId
        console.log("\n📋 Step 1: Finding accounts without plaidAccountId...");
        const accountsSnapshot = await db.collection("accounts").get();
        const missingPlaidIds = [];
        let alreadyHasPlaidId = 0;
        let noAccountId = 0;
        accountsSnapshot.forEach(doc => {
            const data = doc.data();
            // Skip if already has plaidAccountId
            if (data.plaidAccountId) {
                alreadyHasPlaidId++;
                return;
            }
            // Skip if no accountId to copy from
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
        console.log(`   Total accounts: ${accountsSnapshot.size}`);
        console.log(`   Already have plaidAccountId: ${alreadyHasPlaidId}`);
        console.log(`   Missing plaidAccountId (will fix): ${missingPlaidIds.length}`);
        console.log(`   Missing accountId (cannot fix): ${noAccountId}`);
        if (missingPlaidIds.length === 0) {
            return {
                success: true,
                message: "No accounts need fixing",
                fixed: 0,
                alreadyHasPlaidId,
                noAccountId
            };
        }
        // Step 2: Batch update to add plaidAccountId
        console.log("\n🔄 Step 2: Adding plaidAccountId to accounts...");
        // Process in batches of 500 (Firestore limit)
        const BATCH_SIZE = 500;
        let fixed = 0;
        let currentBatch = 0;
        for (let i = 0; i < missingPlaidIds.length; i += BATCH_SIZE) {
            const batchAccounts = missingPlaidIds.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            currentBatch++;
            console.log(`\n   Batch ${currentBatch}: Processing ${batchAccounts.length} accounts...`);
            for (const account of batchAccounts) {
                const ref = db.collection("accounts").doc(account.id);
                batch.update(ref, {
                    plaidAccountId: account.accountId,
                    updatedAt: new Date()
                });
                console.log(`      ✓ ${account.name} -> plaidAccountId: ${account.accountId}`);
                fixed++;
            }
            await batch.commit();
            console.log(`   Batch ${currentBatch} committed`);
        }
        console.log("\n" + "=".repeat(80));
        console.log("✅ COMPLETE");
        console.log("=".repeat(80));
        console.log(`Fixed: ${fixed}`);
        console.log(`Already had plaidAccountId: ${alreadyHasPlaidId}`);
        console.log(`Could not fix (no accountId): ${noAccountId}`);
        console.log(`Total accounts: ${accountsSnapshot.size}`);
        return {
            success: true,
            message: `Fixed ${fixed} accounts`,
            fixed,
            alreadyHasPlaidId,
            noAccountId,
            total: accountsSnapshot.size
        };
    }
    catch (error) {
        console.error("\n❌ Fatal error:", error);
        throw new https_1.HttpsError("internal", `Failed to fix accounts: ${error instanceof Error ? error.message : String(error)}`);
    }
});
//# sourceMappingURL=fixAccountPlaidIds.js.map