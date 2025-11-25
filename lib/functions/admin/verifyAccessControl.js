"use strict";
/**
 * Access Control Verification Script
 *
 * This admin function verifies that the 3-step access control pattern
 * is correctly implemented across all document types:
 * 1. Build complete structure with defaults
 * 2. Enhance with calculated group sharing
 * 3. Merge and save to Firestore (single write)
 *
 * Tests:
 * - Transactions
 * - Accounts
 * - Budgets
 * - Outflows
 * - Outflow Periods
 * - Inflow Periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAccessControl = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const app_1 = require("firebase-admin/app");
// Initialize Firebase Admin if not already initialized
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
/**
 * Verify that a document has the required access control structure
 */
function verifyAccessControlStructure(docId, data) {
    const issues = [];
    // Check root-level query-critical fields
    if (!data.userId) {
        issues.push('Missing userId at root level');
    }
    if (data.groupId === undefined) {
        issues.push('Missing groupId field at root level (should be null or string)');
    }
    if (!Array.isArray(data.accessibleBy)) {
        issues.push('Missing or invalid accessibleBy array at root level');
    }
    else {
        // Verify accessibleBy always includes userId
        if (!data.accessibleBy.includes(data.userId)) {
            issues.push('accessibleBy array does not include userId');
        }
        // If groupId exists, accessibleBy should have more than just userId
        if (data.groupId && data.accessibleBy.length === 1) {
            issues.push('Document has groupId but accessibleBy only contains userId (should include group members)');
        }
        // If no groupId, accessibleBy should only be [userId]
        if (!data.groupId && data.accessibleBy.length > 1) {
            issues.push('Document has no groupId but accessibleBy has multiple members');
        }
    }
    if (!data.isActive) {
        issues.push('Missing isActive field at root level');
    }
    // Check nested access control object
    if (!data.access) {
        issues.push('Missing nested access object');
    }
    else {
        if (data.access.ownerId !== data.userId) {
            issues.push('access.ownerId does not match root userId');
        }
        if (data.access.isPrivate === undefined) {
            issues.push('Missing access.isPrivate field');
        }
        else {
            // Verify isPrivate matches groupId presence
            const expectedIsPrivate = !data.groupId;
            if (data.access.isPrivate !== expectedIsPrivate) {
                issues.push(`access.isPrivate is ${data.access.isPrivate} but should be ${expectedIsPrivate} based on groupId`);
            }
        }
        if (!data.access.sharing) {
            issues.push('Missing access.sharing object');
        }
        else {
            if (data.access.sharing.isShared === undefined) {
                issues.push('Missing access.sharing.isShared field');
            }
            else {
                // Verify isShared matches groupId presence
                const expectedIsShared = !!data.groupId;
                if (data.access.sharing.isShared !== expectedIsShared) {
                    issues.push(`access.sharing.isShared is ${data.access.sharing.isShared} but should be ${expectedIsShared} based on groupId`);
                }
            }
            if (!Array.isArray(data.access.sharing.sharedWith)) {
                issues.push('Missing or invalid access.sharing.sharedWith array');
            }
            else {
                // If groupId exists, sharedWith should have entries
                if (data.groupId && data.access.sharing.sharedWith.length === 0) {
                    issues.push('Document has groupId but access.sharing.sharedWith is empty');
                }
                // Verify sharedWith entries match accessibleBy (minus owner)
                const sharedWithIds = data.access.sharing.sharedWith.map((s) => s.targetId);
                const expectedSharedWith = data.accessibleBy.filter((id) => id !== data.userId);
                const missingInSharedWith = expectedSharedWith.filter((id) => !sharedWithIds.includes(id));
                if (missingInSharedWith.length > 0) {
                    issues.push(`accessibleBy contains members not in sharedWith: ${missingInSharedWith.join(', ')}`);
                }
            }
        }
    }
    return {
        valid: issues.length === 0,
        issues
    };
}
/**
 * Verify a collection's documents
 */
async function verifyCollection(collectionName, limit = 50) {
    var _a, _b, _c, _d, _e, _f;
    const result = {
        collectionName,
        totalDocuments: 0,
        documentsChecked: 0,
        passed: 0,
        failed: 0,
        issues: []
    };
    try {
        // Get a sample of documents from the collection
        const snapshot = await db.collection(collectionName)
            .limit(limit)
            .get();
        result.totalDocuments = snapshot.size;
        result.documentsChecked = snapshot.size;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const verification = verifyAccessControlStructure(doc.id, data);
            if (verification.valid) {
                result.passed++;
            }
            else {
                result.failed++;
                result.issues.push({
                    docId: doc.id,
                    issue: verification.issues.join('; '),
                    details: {
                        userId: data.userId,
                        groupId: data.groupId,
                        accessibleBy: data.accessibleBy,
                        'access.isPrivate': (_a = data.access) === null || _a === void 0 ? void 0 : _a.isPrivate,
                        'access.sharing.isShared': (_c = (_b = data.access) === null || _b === void 0 ? void 0 : _b.sharing) === null || _c === void 0 ? void 0 : _c.isShared,
                        'access.sharing.sharedWith': ((_f = (_e = (_d = data.access) === null || _d === void 0 ? void 0 : _d.sharing) === null || _e === void 0 ? void 0 : _e.sharedWith) === null || _f === void 0 ? void 0 : _f.length) || 0
                    }
                });
            }
        }
    }
    catch (error) {
        console.error(`Error verifying collection ${collectionName}:`, error);
        result.issues.push({
            docId: 'N/A',
            issue: `Collection verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            details: error
        });
    }
    return result;
}
/**
 * Main verification function
 */
exports.verifyAccessControl = (0, https_1.onRequest)({
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (req, res) => {
    try {
        console.log('🔍 Starting access control verification across all collections...');
        // Collections to verify
        const collectionsToVerify = [
            'transactions',
            'accounts',
            'budgets',
            'outflows',
            'outflow_periods',
            'inflow_periods'
        ];
        const results = [];
        // Verify each collection
        for (const collectionName of collectionsToVerify) {
            console.log(`\n📊 Verifying ${collectionName}...`);
            const result = await verifyCollection(collectionName, 50);
            results.push(result);
            console.log(`✅ ${collectionName}: ${result.passed} passed, ${result.failed} failed (${result.documentsChecked} checked)`);
            if (result.failed > 0) {
                console.log(`❌ Issues found in ${collectionName}:`);
                result.issues.forEach((issue, index) => {
                    console.log(`  ${index + 1}. Doc ${issue.docId}: ${issue.issue}`);
                });
            }
        }
        // Calculate overall statistics
        const overallStats = {
            totalCollections: collectionsToVerify.length,
            totalDocuments: results.reduce((sum, r) => sum + r.documentsChecked, 0),
            totalPassed: results.reduce((sum, r) => sum + r.passed, 0),
            totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
            collectionsWithIssues: results.filter(r => r.failed > 0).length
        };
        const allPassed = overallStats.totalFailed === 0;
        console.log('\n' + '='.repeat(80));
        console.log('VERIFICATION SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total Documents Checked: ${overallStats.totalDocuments}`);
        console.log(`Passed: ${overallStats.totalPassed} (${((overallStats.totalPassed / overallStats.totalDocuments) * 100).toFixed(1)}%)`);
        console.log(`Failed: ${overallStats.totalFailed} (${((overallStats.totalFailed / overallStats.totalDocuments) * 100).toFixed(1)}%)`);
        console.log(`Collections with Issues: ${overallStats.collectionsWithIssues} / ${overallStats.totalCollections}`);
        console.log('='.repeat(80));
        if (allPassed) {
            console.log('✅ ALL VERIFICATIONS PASSED! Access control is correctly implemented.');
        }
        else {
            console.log('❌ VERIFICATION FAILED! Please review the issues above.');
        }
        res.status(200).json({
            success: allPassed,
            message: allPassed ? 'All access control verifications passed' : 'Some verifications failed',
            overallStats,
            results,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('❌ Error during access control verification:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});
//# sourceMappingURL=verifyAccessControl.js.map