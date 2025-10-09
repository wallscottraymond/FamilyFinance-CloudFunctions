/**
 * Remove Plaid Account Cloud Function
 *
 * Removes a Plaid-linked account by:
 * 1. Looking up account to get itemId
 * 2. Retrieving access token from plaid_items
 * 3. Calling Plaid itemRemove API to unlink
 * 4. Soft-deleting account (isActive: false)
 * 5. Optionally marking item inactive if no other accounts exist
 *
 * Security: User authentication required (VIEWER role)
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { authenticateRequest, UserRole } from '../../utils/auth';
import { db } from '../../index';
import { createStandardPlaidClient } from '../../utils/plaidClientFactory';
import { decryptAccessToken } from '../../utils/encryption';
import * as admin from 'firebase-admin';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

/**
 * Remove Plaid Account callable function
 */
export const removePlaidAccount = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (request) => {
    try {
      // 1. Authenticate user
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { accountId } = request.data;

      if (!accountId) {
        throw new HttpsError('invalid-argument', 'accountId is required');
      }

      console.log(`[removePlaidAccount] User ${userId} removing account ${accountId}`);

      // 2. Get account document
      const accountDoc = await db.collection('accounts').doc(accountId).get();

      if (!accountDoc.exists) {
        throw new HttpsError('not-found', 'Account not found');
      }

      const accountData = accountDoc.data();

      // 3. Verify ownership
      if (accountData?.userId !== userId) {
        throw new HttpsError(
          'permission-denied',
          'Not authorized to remove this account'
        );
      }

      const itemId = accountData.itemId;

      if (!itemId) {
        throw new HttpsError('failed-precondition', 'Account has no associated Plaid item');
      }

      console.log(`[removePlaidAccount] Account ${accountId} linked to item ${itemId}`);

      // 4. Get plaid_items document for access token
      const itemDoc = await db.collection('plaid_items').doc(itemId).get();

      if (!itemDoc.exists) {
        throw new HttpsError('not-found', 'Plaid item not found');
      }

      const itemData = itemDoc.data();
      const encryptedAccessToken = itemData?.accessToken;

      if (!encryptedAccessToken) {
        throw new HttpsError('failed-precondition', 'Access token not found');
      }

      // 5. Decrypt access token
      const accessToken = decryptAccessToken(encryptedAccessToken);

      // 6. Call Plaid itemRemove API
      let plaidRemovalSuccess = false;
      try {
        const plaidClient = createStandardPlaidClient();
        await plaidClient.itemRemove({ access_token: accessToken });

        console.log(`[removePlaidAccount] Successfully removed Plaid item ${itemId} via API`);
        plaidRemovalSuccess = true;
      } catch (plaidError: any) {
        console.error('[removePlaidAccount] Plaid itemRemove error:', plaidError);

        // Log the error but continue with soft delete
        // Item might already be removed on Plaid's side
        console.warn(
          `[removePlaidAccount] Continuing with soft delete despite Plaid API error`
        );
      }

      // 7. Soft delete account (mark as inactive)
      await db.collection('accounts').doc(accountId).update({
        isActive: false,
        isSyncEnabled: false,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.log(`[removePlaidAccount] Marked account ${accountId} as inactive`);

      // 8. Check if other accounts use this itemId
      const otherAccountsQuery = await db
        .collection('accounts')
        .where('itemId', '==', itemId)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      // 9. If no other active accounts, mark item as inactive
      if (otherAccountsQuery.empty) {
        await db.collection('plaid_items').doc(itemId).update({
          isActive: false,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(
          `[removePlaidAccount] Marked Plaid item ${itemId} as inactive (no active accounts remaining)`
        );
      } else {
        console.log(
          `[removePlaidAccount] Plaid item ${itemId} still has ${otherAccountsQuery.size} active account(s)`
        );
      }

      return {
        success: true,
        message: 'Account removed successfully',
        accountId,
        itemId,
        plaidRemovalSuccess,
        itemStillActive: !otherAccountsQuery.empty,
      };
    } catch (error: any) {
      console.error('[removePlaidAccount] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to remove account');
    }
  }
);
