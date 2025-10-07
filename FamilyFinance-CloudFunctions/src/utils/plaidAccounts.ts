/**
 * Plaid Account Management Utilities
 * 
 * Handles account data retrieval and storage operations
 */

import { PlaidApi, AccountsGetRequest } from 'plaid';
import { db } from '../index';
import * as admin from 'firebase-admin';
import { encryptAccessToken } from './encryption';

export interface ProcessedAccount {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  currentBalance: number;
  availableBalance: number | null;
  currencyCode: string;
  mask: string | null;
  officialName: string | null;
}

/**
 * Retrieves account details from Plaid
 */
export async function fetchPlaidAccounts(
  plaidClient: PlaidApi,
  accessToken: string,
  itemId: string
): Promise<ProcessedAccount[]> {
  try {
    console.log('Fetching account details from Plaid...');
    
    const accountsRequest: AccountsGetRequest = {
      access_token: accessToken,
    };

    const accountsResponse = await plaidClient.accountsGet(accountsRequest);
    const plaidAccounts = accountsResponse.data.accounts;

    console.log('Retrieved account details from Plaid', {
      accountCount: plaidAccounts.length,
      itemId,
    });

    // Process account data
    const processedAccounts: ProcessedAccount[] = plaidAccounts.map(account => ({
      id: account.account_id,
      name: account.name,
      type: account.type,
      subtype: account.subtype || null,
      currentBalance: account.balances.current || 0,
      availableBalance: account.balances.available,
      currencyCode: account.balances.iso_currency_code || 'USD',
      mask: account.mask,
      officialName: account.official_name,
    }));

    return processedAccounts;
  } catch (error) {
    console.error('Failed to fetch account details from Plaid:', error);
    throw new Error(`Account fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Saves Plaid item data to Firestore
 */
export async function savePlaidItem(
  itemId: string,
  userId: string,
  institutionId: string,
  institutionName: string,
  accessToken: string
): Promise<void> {
  try {
    console.log('Saving Plaid item to Firestore...', { itemId, institutionName });

    await db.collection('plaid_items').doc(itemId).set({
      id: itemId,
      plaidItemId: itemId,
      userId: userId,
      familyId: '', // TODO: Get user's familyId from userData
      institutionId: institutionId,
      institutionName: institutionName,
      institutionLogo: null,
      accessToken: encryptAccessToken(accessToken), // Encrypted for security
      cursor: null,
      products: ['transactions'],
      status: 'good',
      error: null,
      lastWebhookReceived: null,
      isActive: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log('Successfully saved Plaid item to Firestore');
  } catch (error) {
    console.error('Failed to save Plaid item:', error);
    throw new Error(`Plaid item save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Saves account documents to Firestore accounts collection
 */
export async function savePlaidAccounts(
  accounts: ProcessedAccount[],
  itemId: string,
  userId: string,
  institutionId: string,
  institutionName: string
): Promise<void> {
  try {
    console.log(`Saving ${accounts.length} account documents to Firestore...`);

    for (const account of accounts) {
      try {
        console.log(`Saving account: ${account.id} (${account.name}) - ${account.type}/${account.subtype}`);

        await db.collection('accounts').doc(account.id).set({
          id: account.id,
          plaidAccountId: account.id,
          accountId: account.id,
          itemId: itemId,
          userId: userId,
          familyId: '', // TODO: Get user's familyId from userData
          institutionId: institutionId,
          institutionName: institutionName,
          accountName: account.name,
          accountType: account.type,
          accountSubtype: account.subtype,
          mask: account.mask,
          officialName: account.officialName,
          currentBalance: account.currentBalance, // Changed from 'balance' to 'currentBalance'
          availableBalance: account.availableBalance,
          limit: null,
          isoCurrencyCode: account.currencyCode,
          isActive: true,
          isSyncEnabled: true,
          lastBalanceUpdate: admin.firestore.Timestamp.now(),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(`Successfully saved account: ${account.id}`);
      } catch (accountError) {
        console.error(`Failed to save account ${account.id}:`, accountError);
        throw new Error(`Account save failed for ${account.id}: ${accountError instanceof Error ? accountError.message : 'Unknown error'}`);
      }
    }

    console.log(`Successfully saved all ${accounts.length} accounts to Firestore`);
  } catch (error) {
    console.error('Failed to save accounts to Firestore:', error);
    throw error; // Re-throw to maintain error context
  }
}