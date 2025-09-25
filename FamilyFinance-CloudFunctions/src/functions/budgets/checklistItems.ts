/**
 * Budget Period Checklist Items Management
 * 
 * This module provides Cloud Functions for managing checklist items within budget periods.
 * Checklist items help users track specific spending categories and goals within a period.
 * 
 * Features:
 * - Add new checklist items to a budget period
 * - Update existing checklist items (name, amounts, checked status)
 * - Delete checklist items from a budget period
 * - Toggle checked status of checklist items
 * 
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ChecklistItem } from '../../types';

// Request/Response interfaces
interface AddChecklistItemRequest {
  budgetPeriodId: string;
  checklistItem: Omit<ChecklistItem, 'id'>;
}

interface UpdateChecklistItemRequest {
  budgetPeriodId: string;
  checklistItemId: string;
  updates: Partial<Omit<ChecklistItem, 'id'>>;
}

interface DeleteChecklistItemRequest {
  budgetPeriodId: string;
  checklistItemId: string;
}

interface ToggleChecklistItemRequest {
  budgetPeriodId: string;
  checklistItemId: string;
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

/**
 * Toggle the checked status of a checklist item
 */
export const toggleChecklistItem = onCall({
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
    const { budgetPeriodId, checklistItemId } = request.data as ToggleChecklistItemRequest;

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

    // Get current checklist items
    const currentChecklistItems: ChecklistItem[] = budgetPeriodData.checklistItems || [];
    const itemIndex = currentChecklistItems.findIndex(item => item.id === checklistItemId);
    
    if (itemIndex === -1) {
      throw new HttpsError('not-found', 'Checklist item not found');
    }

    // Toggle the checked status
    const updatedChecklistItems = [...currentChecklistItems];
    updatedChecklistItems[itemIndex] = {
      ...updatedChecklistItems[itemIndex],
      isChecked: !updatedChecklistItems[itemIndex].isChecked,
    };

    // Update the budget period document
    await budgetPeriodRef.update({
      checklistItems: updatedChecklistItems,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`Toggled checklist item ${checklistItemId} to ${updatedChecklistItems[itemIndex].isChecked} in budget period ${budgetPeriodId}`);

    return {
      success: true,
      checklistItem: updatedChecklistItems[itemIndex],
      message: 'Checklist item toggled successfully',
    } as ChecklistItemResponse;

  } catch (error) {
    console.error('Error toggling checklist item:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to toggle checklist item');
  }
});