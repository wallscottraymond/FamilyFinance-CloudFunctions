"use strict";
/**
 * Format Recurring Inflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring inflow (income) streams.
 * This is Step 1 in the recurring inflow pipeline.
 *
 * Takes raw Plaid inflow stream data and converts it to our internal
 * FLAT inflow structure with ALL required fields from Plaid API.
 *
 * UPDATED: Now produces FLAT structure with all fields at root level.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRecurringInflows = formatRecurringInflows;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Format Plaid inflow streams to internal Inflow documents (FLAT STRUCTURE)
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param inflowStreams - Raw Plaid inflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted flat inflow documents ready for Firestore
 */
async function formatRecurringInflows(inflowStreams, itemId, userId, familyId) {
    console.log(`[formatRecurringInflows] Formatting ${inflowStreams.length} inflow streams (FLAT STRUCTURE)`);
    const now = firestore_1.Timestamp.now();
    return inflowStreams.map(stream => {
        var _a, _b, _c, _d, _e, _f, _g;
        return ({
            // === DOCUMENT IDENTITY ===
            id: stream.stream_id, // Plaid stream_id as Firestore document ID
            // === OWNERSHIP & ACCESS (Query-Critical) ===
            ownerId: userId, // Using ownerId instead of userId for consistency
            createdBy: userId,
            updatedBy: userId,
            groupId: familyId || null,
            // === PLAID IDENTIFIERS ===
            plaidItemId: itemId,
            accountId: stream.account_id,
            // === FINANCIAL DATA ===
            lastAmount: Math.abs(stream.last_amount.amount || 0),
            averageAmount: Math.abs(stream.average_amount.amount || 0),
            currency: stream.average_amount.iso_currency_code || 'USD',
            unofficialCurrency: stream.average_amount.unofficial_currency_code || null,
            // === DESCRIPTIVE INFO ===
            description: stream.description || null,
            merchantName: stream.merchant_name || null,
            userCustomName: null, // User hasn't set a custom name yet
            // === TEMPORAL DATA ===
            frequency: stream.frequency,
            firstDate: firestore_1.Timestamp.fromDate(new Date(stream.first_date)),
            lastDate: firestore_1.Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
                ? firestore_1.Timestamp.fromDate(new Date(stream.predicted_next_date))
                : null,
            // === CATEGORIZATION (Flat fields from Plaid) ===
            plaidPrimaryCategory: ((_a = stream.personal_finance_category) === null || _a === void 0 ? void 0 : _a.primary) || ((_b = stream.category) === null || _b === void 0 ? void 0 : _b[0]) || 'INCOME',
            plaidDetailedCategory: ((_c = stream.personal_finance_category) === null || _c === void 0 ? void 0 : _c.detailed) || ((_d = stream.category) === null || _d === void 0 ? void 0 : _d[1]) || '',
            plaidCategoryId: stream.category_id || null,
            internalPrimaryCategory: null, // User hasn't overridden yet
            internalDetailedCategory: null, // User hasn't overridden yet
            // === INCOME CLASSIFICATION ===
            incomeType: ((_e = stream.personal_finance_category) === null || _e === void 0 ? void 0 : _e.detailed) === 'INCOME_WAGES' ? 'salary' : 'other',
            isRegularSalary: ((_f = stream.personal_finance_category) === null || _f === void 0 ? void 0 : _f.detailed) === 'INCOME_WAGES',
            // === STATUS & CONTROL ===
            source: 'plaid',
            isActive: stream.is_active,
            isHidden: false, // Default to visible
            isUserModified: stream.is_user_modified || false,
            plaidStatus: stream.status,
            plaidConfidenceLevel: ((_g = stream.personal_finance_category) === null || _g === void 0 ? void 0 : _g.confidence_level) || null,
            // === TRANSACTION REFERENCES ===
            transactionIds: stream.transaction_ids || [],
            // === USER INTERACTION ===
            tags: [],
            rules: [],
            // === AUDIT TRAIL ===
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now
        });
    });
}
//# sourceMappingURL=formatRecurringInflows.js.map