/**
 * Plaid Recurring Transactions Utilities
 * 
 * Handles recurring transaction streams (income and expense patterns)
 */

import { PlaidApi, TransactionsRecurringGetRequest } from 'plaid';
import { db } from '../index';
import * as admin from 'firebase-admin';

export interface RecurringProcessingResult {
  totalStreams: number;
  inflowStreams: number;
  outflowStreams: number;
  accountsProcessed: number;
  errors: number;
}

/**
 * Fetches and processes recurring transactions from Plaid
 */
export async function processRecurringTransactions(
  plaidClient: PlaidApi,
  accessToken: string,
  accountIds: string[],
  userId: string
): Promise<RecurringProcessingResult> {
  const result: RecurringProcessingResult = {
    totalStreams: 0,
    inflowStreams: 0,
    outflowStreams: 0,
    accountsProcessed: 0,
    errors: 0
  };

  try {
    console.log('Fetching recurring transactions from Plaid for', accountIds.length, 'accounts...');
    
    // Call Plaid API for all accounts at once (more efficient)
    const recurringRequest: TransactionsRecurringGetRequest = {
      access_token: accessToken,
      account_ids: accountIds,
    };

    console.log('Calling Plaid transactionsRecurringGet with account IDs:', recurringRequest.account_ids);
    
    const recurringResponse = await plaidClient.transactionsRecurringGet(recurringRequest);
    const { inflow_streams: inflowStreams, outflow_streams: outflowStreams } = recurringResponse.data;

    console.log('Retrieved recurring transactions from Plaid', {
      inflowStreams: inflowStreams.length,
      outflowStreams: outflowStreams.length,
      totalStreams: inflowStreams.length + outflowStreams.length,
    });

    // Process inflow streams (income)
    if (inflowStreams.length > 0) {
      const inflowResult = await processInflowStreams(inflowStreams, userId);
      result.inflowStreams = inflowResult.processed;
      result.errors += inflowResult.errors;
    }

    // Process outflow streams (expenses)
    if (outflowStreams.length > 0) {
      const outflowResult = await processOutflowStreams(outflowStreams, userId);
      result.outflowStreams = outflowResult.processed;
      result.errors += outflowResult.errors;
    }

    result.totalStreams = result.inflowStreams + result.outflowStreams;
    result.accountsProcessed = accountIds.length;

    console.log('Successfully processed recurring transactions:', {
      totalStreams: result.totalStreams,
      inflowStreams: result.inflowStreams,
      outflowStreams: result.outflowStreams,
      accountsProcessed: result.accountsProcessed,
      errors: result.errors
    });

    return result;

  } catch (error) {
    console.error('Failed to process recurring transactions:', error);
    result.errors++;
    return result;
  }
}

/**
 * Processes inflow streams (income patterns) 
 */
async function processInflowStreams(streams: any[], userId: string): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  console.log('Processing', streams.length, 'inflow streams...');

  for (const stream of streams) {
    try {
      const streamId = stream.stream_id;
      console.log(`Processing income stream ${streamId} for account ${stream.account_id}`);

      await db.collection('inflows').doc(streamId).set({
        id: streamId,
        plaidStreamId: streamId,
        accountId: stream.account_id,
        userId: userId,
        familyId: '', // TODO: Get user's familyId from userData
        
        // Basic stream info
        description: stream.description || 'Recurring Income',
        merchantName: stream.merchant_name || null,
        category: stream.category || [],
        
        // Amount information
        averageAmount: Math.abs(stream.average_amount?.amount || 0),
        lastAmount: Math.abs(stream.last_amount?.amount || 0),
        currency: stream.average_amount?.iso_currency_code || 'USD',
        
        // Frequency and prediction
        frequency: stream.frequency || 'UNKNOWN',
        isActive: stream.is_active || true,
        status: 'active',
        
        // Income-specific fields
        incomeType: 'other', // Default, user can categorize
        taxable: true, // Default assumption

        // Source tracking
        inflowSource: 'plaid', // Source of this inflow: 'user' or 'plaid'

        // Metadata
        firstDate: stream.first_date ? admin.firestore.Timestamp.fromDate(new Date(stream.first_date)) : null,
        lastDate: stream.last_date ? admin.firestore.Timestamp.fromDate(new Date(stream.last_date)) : null,
        transactionIds: stream.transaction_ids || [],
        
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        createdBy: userId,
      });

      console.log(`Successfully saved income stream ${streamId}`);
      processed++;
    } catch (error) {
      console.error(`Error processing income stream ${stream.stream_id}:`, error);
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Processes outflow streams (expense patterns)
 */
async function processOutflowStreams(streams: any[], userId: string): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  console.log('Processing', streams.length, 'outflow streams...');

  for (const stream of streams) {
    try {
      const streamId = stream.stream_id;
      console.log(`Processing outflow stream ${streamId} for account ${stream.account_id}`);

      await db.collection('outflows').doc(streamId).set({
        id: streamId,
        plaidStreamId: streamId,
        accountId: stream.account_id,
        userId: userId,
        familyId: '', // TODO: Get user's familyId from userData
        
        // Basic stream info
        description: stream.description || 'Recurring Expense',
        merchantName: stream.merchant_name || null,
        category: stream.category || [],
        
        // Amount information
        averageAmount: Math.abs(stream.average_amount?.amount || 0),
        lastAmount: Math.abs(stream.last_amount?.amount || 0),
        currency: stream.average_amount?.iso_currency_code || 'USD',
        
        // Frequency and prediction
        frequency: stream.frequency || 'UNKNOWN',
        isActive: stream.is_active || true,
        status: 'active',
        
        // Expense-specific fields
        expenseType: 'other', // Default, user can categorize
        isEssential: false, // User can mark as essential

        // Source tracking
        outflowSource: 'plaid', // Source of this outflow: 'user' or 'plaid'

        // Metadata
        firstDate: stream.first_date ? admin.firestore.Timestamp.fromDate(new Date(stream.first_date)) : null,
        lastDate: stream.last_date ? admin.firestore.Timestamp.fromDate(new Date(stream.last_date)) : null,
        transactionIds: stream.transaction_ids || [],
        
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        createdBy: userId,
      });

      console.log(`Successfully saved outflow stream ${streamId}`);
      processed++;
    } catch (error) {
      console.error(`Error processing outflow stream ${stream.stream_id}:`, error);
      errors++;
    }
  }

  return { processed, errors };
}