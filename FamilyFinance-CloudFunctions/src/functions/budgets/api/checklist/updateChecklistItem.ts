/**
 * Update Checklist Item in Budget Period
 *
 * Cloud Function for updating existing checklist items in budget periods.
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ChecklistItem } from '../../../../types';

// Request/Response interfaces
interface UpdateChecklistItemRequest {
  budgetPeriodId: string;
  checklistItemId: string;
  updates: Partial<Omit<ChecklistItem, 'id'>>;
}

interface ChecklistItemResponse {
  success: boolean;
  checklistItem?: ChecklistItem;
  message?: string;
}

/**
 * Update an existing checklist item in a budget period
 */
export const updateChecklistItem = onCall({
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
    const { budgetPeriodId, checklistItemId, updates } = request.data as UpdateChecklistItemRequest;

    if (!budgetPeriodId || !checklistItemId || !updates) {
      throw new HttpsError('invalid-argument', 'budgetPeriodId, checklistItemId, and updates are required');
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

    // Get current checklist items
    const currentChecklistItems: ChecklistItem[] = budgetPeriodData.checklistItems || [];
    const itemIndex = currentChecklistItems.findIndex(item => item.id === checklistItemId);

    if (itemIndex === -1) {
      throw new HttpsError('not-found', 'Checklist item not found');
    }

    // Update the specific checklist item
    const updatedChecklistItems = [...currentChecklistItems];
    updatedChecklistItems[itemIndex] = {
      ...updatedChecklistItems[itemIndex],
      ...updates,
      id: checklistItemId, // Ensure ID doesn't change
    };

    // Update the budget period document
    await budgetPeriodRef.update({
      checklistItems: updatedChecklistItems,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`Updated checklist item ${checklistItemId} in budget period ${budgetPeriodId}`);

    return {
      success: true,
      checklistItem: updatedChecklistItems[itemIndex],
      message: 'Checklist item updated successfully',
    } as ChecklistItemResponse;

  } catch (error) {
    console.error('Error updating checklist item:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to update checklist item');
  }
});
