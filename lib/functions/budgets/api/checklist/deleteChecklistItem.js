"use strict";
/**
 * Delete Checklist Item from Budget Period
 *
 * Cloud Function for removing checklist items from budget periods.
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteChecklistItem = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
/**
 * Delete a checklist item from a budget period
 */
exports.deleteChecklistItem = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Validate authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const user = request.auth;
        const { budgetPeriodId, checklistItemId } = request.data;
        if (!budgetPeriodId || !checklistItemId) {
            throw new https_1.HttpsError('invalid-argument', 'budgetPeriodId and checklistItemId are required');
        }
        const db = admin.firestore();
        // Get budget period to verify ownership
        const budgetPeriodRef = db.collection('budget_periods').doc(budgetPeriodId);
        const budgetPeriodDoc = await budgetPeriodRef.get();
        if (!budgetPeriodDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Budget period not found');
        }
        const budgetPeriodData = budgetPeriodDoc.data();
        // Check if user owns this budget period
        if (budgetPeriodData.userId !== user.uid) {
            throw new https_1.HttpsError('permission-denied', 'You can only modify your own budget periods');
        }
        // Get current checklist items and remove the specified one
        const currentChecklistItems = budgetPeriodData.checklistItems || [];
        const updatedChecklistItems = currentChecklistItems.filter(item => item.id !== checklistItemId);
        if (updatedChecklistItems.length === currentChecklistItems.length) {
            throw new https_1.HttpsError('not-found', 'Checklist item not found');
        }
        // Update the budget period document
        await budgetPeriodRef.update({
            checklistItems: updatedChecklistItems,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        console.log(`Deleted checklist item ${checklistItemId} from budget period ${budgetPeriodId}`);
        return {
            success: true,
            message: 'Checklist item deleted successfully',
        };
    }
    catch (error) {
        console.error('Error deleting checklist item:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to delete checklist item');
    }
});
//# sourceMappingURL=deleteChecklistItem.js.map