/**
 * Delete Checklist Item from Budget Period
 *
 * Cloud Function for removing checklist items from budget periods.
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ChecklistItem } from '../../../../types';

// Request/Response interfaces
interface DeleteChecklistItemRequest {
  budgetPeriodId: string;
  checklistItemId: string;
}

interface ChecklistItemResponse {
  success: boolean;
  checklistItem?: ChecklistItem;
  message?: string;
}

/**
 * Delete a checklist item from a budget period
 */
export const deleteChecklistItem = onCall({
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
    const { budgetPeriodId, checklistItemId } = request.data as DeleteChecklistItemRequest;

    if (!budgetPeriodId || !checklistItemId) {
      throw new HttpsError('invalid-argument', 'budgetPeriodId and checklistItemId are required');
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

    // Get current checklist items and remove the specified one
    const currentChecklistItems: ChecklistItem[] = budgetPeriodData.checklistItems || [];
    const updatedChecklistItems = currentChecklistItems.filter(item => item.id !== checklistItemId);

    if (updatedChecklistItems.length === currentChecklistItems.length) {
      throw new HttpsError('not-found', 'Checklist item not found');
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
    } as ChecklistItemResponse;

  } catch (error) {
    console.error('Error deleting checklist item:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to delete checklist item');
  }
});
