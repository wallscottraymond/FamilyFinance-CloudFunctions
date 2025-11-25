/**
 * Add Checklist Item to Budget Period
 *
 * Cloud Function for adding new checklist items to budget periods.
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ChecklistItem } from '../../../../types';

// Request/Response interfaces
interface AddChecklistItemRequest {
  budgetPeriodId: string;
  checklistItem: Omit<ChecklistItem, 'id'>;
}

interface ChecklistItemResponse {
  success: boolean;
  checklistItem?: ChecklistItem;
  message?: string;
}

/**
 * Add a new checklist item to a budget period
 */
export const addChecklistItem = onCall({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request) => {
  try {
    // Validate authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const user = request.auth;
    const { budgetPeriodId, checklistItem } = request.data as AddChecklistItemRequest;

    if (!budgetPeriodId || !checklistItem) {
      throw new HttpsError('invalid-argument', 'budgetPeriodId and checklistItem are required');
    }

    // Validate checklist item structure
    if (!checklistItem.name || typeof checklistItem.expectedAmount !== 'number') {
      throw new HttpsError('invalid-argument', 'Checklist item must have name and expectedAmount');
    }

    const db = admin.firestore();

    // Get budget period to verify ownership
    const budgetPeriodRef = db.collection('budget_periods').doc(budgetPeriodId);
    const budgetPeriodDoc = await budgetPeriodRef.get();

    if (!budgetPeriodDoc.exists) {
      throw new HttpsError('not-found', 'Budget period not found');
    }

    const budgetPeriodData = budgetPeriodDoc.data()!;

    // Check if user owns this budget period
    if (budgetPeriodData.userId !== user.uid) {
      throw new HttpsError('permission-denied', 'You can only modify your own budget periods');
    }

    // Generate a unique ID for the checklist item
    const checklistItemId = db.collection('_dummy').doc().id;

    const newChecklistItem: ChecklistItem = {
      id: checklistItemId,
      name: checklistItem.name,
      transactionSplit: checklistItem.transactionSplit || '',
      expectedAmount: checklistItem.expectedAmount,
      actualAmount: checklistItem.actualAmount || 0,
      isChecked: checklistItem.isChecked || false,
    };

    // Get current checklist items and add the new one
    const currentChecklistItems = budgetPeriodData.checklistItems || [];
    const updatedChecklistItems = [...currentChecklistItems, newChecklistItem];

    // Update the budget period document
    await budgetPeriodRef.update({
      checklistItems: updatedChecklistItems,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`Added checklist item ${checklistItemId} to budget period ${budgetPeriodId}`);

    return {
      success: true,
      checklistItem: newChecklistItem,
      message: 'Checklist item added successfully',
    } as ChecklistItemResponse;

  } catch (error) {
    console.error('Error adding checklist item:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to add checklist item');
  }
});
