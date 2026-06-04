"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fix_account_plaid_ids = void 0;
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
 * Call via Firebase Console or httpsCallable
 */
exports.fix_account_plaid_ids = (0, https_1.onCall)(async () => {
    console.log("=".repeat(80));
    console.log("🔧 ADMIN: Fixing Account PlaidAccountIds");
    console.log("=".repeat(80));
    try {
        // Step 1: Find all accounts missing plaidAccountId but have accountId
        console.log("\n📋 Step 1: Finding accounts without plaidAccountId...");
        const accounts_snapshot = await db.collection("accounts").get();
        const missing_plaid_ids = [];
        let already_has_plaid_id = 0;
        let no_account_id = 0;
        accounts_snapshot.forEach(doc => {
            const data = doc.data();
            // Skip if already has plaidAccountId
            if (data.plaidAccountId) {
                already_has_plaid_id++;
                return;
            }
            // Skip if no accountId to copy from
            if (!data.accountId) {
                console.warn(`   ⚠️ Account ${doc.id} has no accountId field`);
                no_account_id++;
                return;
            }
            missing_plaid_ids.push({
                id: doc.id,
                account_id: data.accountId,
                name: data.name || data.accountName || "Unknown"
            });
        });
        console.log(`   Total accounts: ${accounts_snapshot.size}`);
        console.log(`   Already have plaidAccountId: ${already_has_plaid_id}`);
        console.log(`   Missing plaidAccountId (will fix): ${missing_plaid_ids.length}`);
        console.log(`   Missing accountId (cannot fix): ${no_account_id}`);
        if (missing_plaid_ids.length === 0) {
            return {
                success: true,
                message: "No accounts need fixing",
                fixed: 0,
                already_has_plaid_id,
                no_account_id
            };
        }
        // Step 2: Batch update to add plaidAccountId
        console.log("\n🔄 Step 2: Adding plaidAccountId to accounts...");
        // Process in batches of 500 (Firestore limit)
        const BATCH_SIZE = 500;
        let fixed = 0;
        let current_batch = 0;
        for (let i = 0; i < missing_plaid_ids.length; i += BATCH_SIZE) {
            const batch_accounts = missing_plaid_ids.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            current_batch++;
            console.log(`\n   Batch ${current_batch}: Processing ${batch_accounts.length} accounts...`);
            for (const account of batch_accounts) {
                const ref = db.collection("accounts").doc(account.id);
                batch.update(ref, {
                    plaidAccountId: account.account_id,
                    updatedAt: new Date()
                });
                console.log(`      ✓ ${account.name} -> plaidAccountId: ${account.account_id}`);
                fixed++;
            }
            await batch.commit();
            console.log(`   Batch ${current_batch} committed`);
        }
        console.log("\n" + "=".repeat(80));
        console.log("✅ COMPLETE");
        console.log("=".repeat(80));
        console.log(`Fixed: ${fixed}`);
        console.log(`Already had plaidAccountId: ${already_has_plaid_id}`);
        console.log(`Could not fix (no accountId): ${no_account_id}`);
        console.log(`Total accounts: ${accounts_snapshot.size}`);
        return {
            success: true,
            message: `Fixed ${fixed} accounts`,
            fixed,
            already_has_plaid_id,
            no_account_id,
            total: accounts_snapshot.size
        };
    }
    catch (error) {
        console.error("\n❌ Fatal error:", error);
        throw new https_1.HttpsError("internal", `Failed to fix accounts: ${error instanceof Error ? error.message : String(error)}`);
    }
});
//# sourceMappingURL=fix_account_plaid_ids.js.map