"use strict";
/**
 * Plaid Recurring Transactions Utilities
 *
 * Handles recurring transaction streams (income and expense patterns)
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
exports.processRecurringTransactions = processRecurringTransactions;
const index_1 = require("../index");
const admin = __importStar(require("firebase-admin"));
/**
 * Fetches and processes recurring transactions from Plaid
 */
async function processRecurringTransactions(plaidClient, accessToken, accountIds, userId) {
    const result = {
        totalStreams: 0,
        inflowStreams: 0,
        outflowStreams: 0,
        accountsProcessed: 0,
        errors: 0
    };
    try {
        console.log('Fetching recurring transactions from Plaid for', accountIds.length, 'accounts...');
        // Call Plaid API for all accounts at once (more efficient)
        const recurringRequest = {
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
    }
    catch (error) {
        console.error('Failed to process recurring transactions:', error);
        result.errors++;
        return result;
    }
}
/**
 * Processes inflow streams (income patterns)
 */
async function processInflowStreams(streams, userId) {
    var _a, _b, _c;
    let processed = 0;
    let errors = 0;
    console.log('Processing', streams.length, 'inflow streams...');
    for (const stream of streams) {
        try {
            const streamId = stream.stream_id;
            console.log(`Processing income stream ${streamId} for account ${stream.account_id}`);
            await index_1.db.collection('inflows').doc(streamId).set({
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
                averageAmount: Math.abs(((_a = stream.average_amount) === null || _a === void 0 ? void 0 : _a.amount) || 0),
                lastAmount: Math.abs(((_b = stream.last_amount) === null || _b === void 0 ? void 0 : _b.amount) || 0),
                currency: ((_c = stream.average_amount) === null || _c === void 0 ? void 0 : _c.iso_currency_code) || 'USD',
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
        }
        catch (error) {
            console.error(`Error processing income stream ${stream.stream_id}:`, error);
            errors++;
        }
    }
    return { processed, errors };
}
/**
 * Processes outflow streams (expense patterns)
 */
async function processOutflowStreams(streams, userId) {
    var _a, _b, _c;
    let processed = 0;
    let errors = 0;
    console.log('Processing', streams.length, 'outflow streams...');
    for (const stream of streams) {
        try {
            const streamId = stream.stream_id;
            console.log(`Processing outflow stream ${streamId} for account ${stream.account_id}`);
            await index_1.db.collection('outflows').doc(streamId).set({
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
                averageAmount: Math.abs(((_a = stream.average_amount) === null || _a === void 0 ? void 0 : _a.amount) || 0),
                lastAmount: Math.abs(((_b = stream.last_amount) === null || _b === void 0 ? void 0 : _b.amount) || 0),
                currency: ((_c = stream.average_amount) === null || _c === void 0 ? void 0 : _c.iso_currency_code) || 'USD',
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
        }
        catch (error) {
            console.error(`Error processing outflow stream ${stream.stream_id}:`, error);
            errors++;
        }
    }
    return { processed, errors };
}
//# sourceMappingURL=plaidRecurring.js.map