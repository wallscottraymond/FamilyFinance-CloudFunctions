import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { authenticateRequest, UserRole } from '../../../utils/auth';

const db = getFirestore();

interface PlaidErrorHandlerRequest {
  itemId: string;
  userId?: string; // Optional - will be extracted from auth if not provided
  error: any; // The full error object from Plaid
  context?: string; // Optional context about where the error occurred
}

/**
 * Internal handler function that can be called directly from other cloud functions
 * Bypasses authentication since it's called from trusted code
 */
export async function handlePlaidErrorInternal(
  itemId: string,
  userId: string,
  error: any,
  context?: string
): Promise<{
  success: boolean;
  actionsPerformed: string[];
}> {
  console.log(`🔍 Handling Plaid error for item ${itemId}, user ${userId}`, {
    context,
    errorCode: error.response?.data?.error_code,
    errorType: error.response?.data?.error_type
  });

  const actions: string[] = [];

  // Check if this is a re-authentication error
  if (isPlaidReauthError(error)) {
    await updateItemStatusToReauth(itemId, userId, error);
    actions.push('updated_status_to_reauth');
  }

  // Check if this is an item removal error
  if (isPlaidItemRemovedError(error)) {
    await updateItemStatusToRemoved(itemId, userId, error);
    actions.push('updated_status_to_removed');
  }

  // Check if this is a rate limit error
  if (isPlaidRateLimitError(error)) {
    await updateItemStatusToRateLimited(itemId, userId, error);
    actions.push('updated_status_to_rate_limited');
  }

  // Check if this is a temporary error
  if (isPlaidTemporaryError(error)) {
    await updateItemStatusToTemporaryError(itemId, userId, error);
    actions.push('updated_status_to_temporary_error');
  }

  return {
    success: true,
    actionsPerformed: actions
  };
}

/**
 * Centralized Plaid error handler
 * Analyzes Plaid errors and takes appropriate actions like updating item status
 */
export const plaidErrorHandler = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Authenticate user
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const authenticatedUserId = authResult.user.uid;

      const { itemId, userId, error, context } = request.data as PlaidErrorHandlerRequest;

      if (!itemId) {
        throw new HttpsError('invalid-argument', 'itemId is required');
      }

      if (!error) {
        throw new HttpsError('invalid-argument', 'error object is required');
      }

      // Use authenticated user ID if userId not provided
      const targetUserId = userId || authenticatedUserId;

      // Ensure user can only handle their own errors (or admins can handle any)
      if (targetUserId !== authenticatedUserId && authResult.user.role !== UserRole.ADMIN) {
        throw new HttpsError('permission-denied', 'You can only handle your own Plaid errors');
      }

      // Use the internal handler
      const result = await handlePlaidErrorInternal(itemId, targetUserId, error, context);
      const actions = result.actionsPerformed;

      return {
        success: true,
        itemId,
        userId: targetUserId,
        actionsPerformed: actions,
        message: `Handled Plaid error for item ${itemId}, performed ${actions.length} actions`
      };

    } catch (error: any) {
      console.error('Error in plaidErrorHandler:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to handle Plaid error');
    }
  }
);

/**
 * Check if error requires re-authentication
 */
function isPlaidReauthError(error: any): boolean {
  if (error.response?.data?.error_code) {
    const errorCode = error.response.data.error_code;
    const reauthErrorCodes = [
      'ITEM_LOGIN_REQUIRED',           // Login details changed
      'ACCESS_NOT_GRANTED',            // User revoked access
      'INSTITUTION_ERROR',             // Institution-side issues
      'INSTITUTION_DOWN',              // Institution temporarily unavailable
      'INSTITUTION_NOT_RESPONDING',    // Institution not responding
      'INVALID_CREDENTIALS',           // Invalid login credentials
      'INVALID_MFA',                   // Invalid MFA response
      'INVALID_SEND_METHOD',           // Invalid MFA send method
      'ITEM_LOCKED',                   // Item locked due to invalid credentials
      'USER_SETUP_REQUIRED',           // User needs to complete setup
      'MFA_NOT_SUPPORTED',             // MFA not supported for this item
      'NO_ACCOUNTS',                   // No accounts available for this item
      'ITEM_NOT_SUPPORTED'             // Item not supported
    ];
    return reauthErrorCodes.includes(errorCode);
  }
  return false;
}

/**
 * Check if error indicates item was removed/deleted
 */
function isPlaidItemRemovedError(error: any): boolean {
  if (error.response?.data?.error_code) {
    const errorCode = error.response.data.error_code;
    const removedErrorCodes = [
      'ITEM_NOT_FOUND',               // Item was deleted
      'ACCESS_NOT_GRANTED'            // User revoked access permanently
    ];
    return removedErrorCodes.includes(errorCode);
  }
  return false;
}

/**
 * Check if error is due to rate limiting
 */
function isPlaidRateLimitError(error: any): boolean {
  if (error.response?.data?.error_code) {
    const errorCode = error.response.data.error_code;
    return errorCode === 'RATE_LIMIT_EXCEEDED';
  }
  return false;
}

/**
 * Check if error is temporary and should retry later
 */
function isPlaidTemporaryError(error: any): boolean {
  if (error.response?.data?.error_code) {
    const errorCode = error.response.data.error_code;
    const temporaryErrorCodes = [
      'INTERNAL_SERVER_ERROR',         // Plaid server error
      'PLANNED_MAINTENANCE',           // Planned maintenance
      'INSTITUTION_DOWN',              // Institution temporarily down
      'INSTITUTION_NOT_RESPONDING'     // Institution not responding
    ];
    return temporaryErrorCodes.includes(errorCode);
  }
  return false;
}

/**
 * Update Plaid item status to 'reauth' when re-authentication is needed
 */
async function updateItemStatusToReauth(itemId: string, userId: string, error: any): Promise<void> {
  await updateItemStatus(itemId, userId, 'reauth', error);
}

/**
 * Update Plaid item status to 'removed' when item is deleted/revoked
 */
async function updateItemStatusToRemoved(itemId: string, userId: string, error: any): Promise<void> {
  await updateItemStatus(itemId, userId, 'removed', error);
}

/**
 * Update Plaid item status to 'rate_limited' when rate limited
 */
async function updateItemStatusToRateLimited(itemId: string, userId: string, error: any): Promise<void> {
  await updateItemStatus(itemId, userId, 'rate_limited', error);
}

/**
 * Update Plaid item status to 'temporary_error' for temporary issues
 */
async function updateItemStatusToTemporaryError(itemId: string, userId: string, error: any): Promise<void> {
  await updateItemStatus(itemId, userId, 'temporary_error', error);
}

/**
 * Generic function to update item status with error details
 */
async function updateItemStatus(itemId: string, userId: string, status: string, error: any): Promise<void> {
  try {
    console.log(`🔄 Updating item ${itemId} status to '${status}'`);

    // Extract error details from Plaid response
    let errorDetails: any = { message: error.message };
    if (error.response?.data) {
      errorDetails = {
        errorCode: error.response.data.error_code,
        errorType: error.response.data.error_type,
        errorMessage: error.response.data.error_message,
        displayMessage: error.response.data.display_message,
        requestId: error.response.data.request_id
      };
    }

    const updateData = {
      status,
      error: errorDetails,
      updatedAt: new Date(),
      lastErrorAt: new Date()
    };

    // Try to update in subcollection first (user/{userId}/plaidItems/{itemId})
    const subCollectionQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('itemId', '==', itemId)
      .limit(1)
      .get();

    if (!subCollectionQuery.empty) {
      const doc = subCollectionQuery.docs[0];
      await doc.ref.update(updateData);
      console.log(`✅ Updated item ${itemId} status to '${status}' in subcollection`);
      return;
    }

    // Try to update in top-level collection (plaid_items)
    const topLevelQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!topLevelQuery.empty) {
      const doc = topLevelQuery.docs[0];
      await doc.ref.update(updateData);
      console.log(`✅ Updated item ${itemId} status to '${status}' in top-level collection`);
      return;
    }

    console.warn(`⚠️ Could not find item ${itemId} for user ${userId} to update status`);

  } catch (error) {
    console.error(`❌ Error updating item ${itemId} status to '${status}':`, error);
    throw error;
  }
}