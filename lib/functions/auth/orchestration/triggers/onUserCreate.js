"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const initializeOutflowSummaries_1 = require("../../utils/initializeOutflowSummaries");
/**
 * Trigger when a user document is created
 * Initializes outflow summary collections for the new user
 */
exports.onUserCreated = (0, firestore_1.onDocumentCreated)({
    document: 'users/{userId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    const userId = event.params.userId;
    const userData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    console.log(`🆕 New user created: ${userId}`);
    try {
        // Initialize outflow summary collections
        await (0, initializeOutflowSummaries_1.initializeOutflowSummaries)(userId);
        // Initialize group outflow summaries if user belongs to groups
        if ((userData === null || userData === void 0 ? void 0 : userData.groupIds) && Array.isArray(userData.groupIds) && userData.groupIds.length > 0) {
            console.log(`📊 User belongs to ${userData.groupIds.length} group(s), initializing group summaries`);
            for (const groupId of userData.groupIds) {
                await (0, initializeOutflowSummaries_1.initializeGroupOutflowSummaries)(groupId);
            }
        }
        console.log(`✅ Successfully initialized summaries for user ${userId}`);
    }
    catch (error) {
        console.error(`❌ Error initializing summaries for user ${userId}:`, error);
        throw error; // Re-throw to ensure Cloud Functions retries
    }
});
//# sourceMappingURL=onUserCreate.js.map