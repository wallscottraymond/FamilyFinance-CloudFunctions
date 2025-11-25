"use strict";
/**
 * Format Recurring Outflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring outflow (expense) streams.
 * This is Step 1 in the recurring outflow pipeline.
 *
 * Takes raw Plaid outflow stream data and converts it to our FLAT internal
 * outflow structure with ALL fields at root level (no nested objects).
 *
 * IMPORTANT: This produces the NEW flat structure. Old outflows with nested
 * structure will remain untouched and continue to work.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRecurringOutflows = formatRecurringOutflows;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Format Plaid outflow streams to flat Outflow documents
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param outflowStreams - Raw Plaid outflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of flat outflow documents ready for Firestore
 */
async function formatRecurringOutflows(outflowStreams, itemId, userId, familyId) {
    console.log(`[formatRecurringOutflows] Formatting ${outflowStreams.length} outflow streams to FLAT structure`);
    return outflowStreams.map(stream => {
        var _a, _b, _c, _d;
        const outflow = {
            // === DOCUMENT IDENTITY ===
            id: stream.stream_id,
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
            // === OWNERSHIP & ACCESS ===
            ownerId: userId,
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
            // === DESCRIPTIVE INFO ===
            description: stream.description || null,
            merchantName: stream.merchant_name || null,
            userCustomName: null, // User hasn't set custom name yet
            // === TEMPORAL DATA ===
            frequency: stream.frequency,
            firstDate: firestore_1.Timestamp.fromDate(new Date(stream.first_date)),
            lastDate: firestore_1.Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
                ? firestore_1.Timestamp.fromDate(new Date(stream.predicted_next_date))
                : null,
            // === CATEGORIZATION ===
            plaidPrimaryCategory: ((_a = stream.personal_finance_category) === null || _a === void 0 ? void 0 : _a.primary) || ((_b = stream.category) === null || _b === void 0 ? void 0 : _b[0]) || 'GENERAL_SERVICES',
            plaidDetailedCategory: ((_c = stream.personal_finance_category) === null || _c === void 0 ? void 0 : _c.detailed) || ((_d = stream.category) === null || _d === void 0 ? void 0 : _d[1]) || '',
            internalPrimaryCategory: null, // User hasn't overridden yet
            internalDetailedCategory: null, // User hasn't overridden yet
            type: determineTransactionType(stream),
            // === LEGACY FIELDS (maintained for backward compatibility) ===
            expenseType: determineExpenseType(stream),
            isEssential: isEssentialExpense(stream),
            // === STATUS & CONTROL ===
            source: 'plaid',
            isActive: stream.is_active,
            isHidden: false,
            isUserModified: stream.is_user_modified || false,
            plaidStatus: stream.status,
            // === TRANSACTION REFERENCES ===
            transactionIds: stream.transaction_ids || [],
            // === USER INTERACTION ===
            tags: [],
            rules: [] // Empty array for future use
        };
        return outflow;
    });
}
/**
 * Determine transaction type from Plaid stream
 *
 * @param stream - Plaid transaction stream
 * @returns Transaction type string
 */
function determineTransactionType(stream) {
    var _a;
    // Use Plaid's transaction type if available
    if (stream.transaction_type) {
        return stream.transaction_type;
    }
    // Fall back to frequency-based classification
    const freq = (_a = stream.frequency) === null || _a === void 0 ? void 0 : _a.toUpperCase();
    if (freq === 'MONTHLY' || freq === 'ANNUALLY') {
        return 'subscription';
    }
    return 'recurring';
}
/**
 * Determine expense type based on Plaid category
 *
 * Legacy field maintained for backward compatibility with existing UI/logic.
 */
function determineExpenseType(stream) {
    var _a, _b;
    const detailed = (_b = (_a = stream.personal_finance_category) === null || _a === void 0 ? void 0 : _a.detailed) === null || _b === void 0 ? void 0 : _b.toUpperCase();
    if ((detailed === null || detailed === void 0 ? void 0 : detailed.includes('UTILITIES')) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes('ELECTRIC')) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes('GAS')) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes('WATER'))) {
        return 'utility';
    }
    if ((detailed === null || detailed === void 0 ? void 0 : detailed.includes('RENT')) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes('MORTGAGE'))) {
        return 'rent';
    }
    if (detailed === null || detailed === void 0 ? void 0 : detailed.includes('INSURANCE')) {
        return 'insurance';
    }
    if ((detailed === null || detailed === void 0 ? void 0 : detailed.includes('LOAN')) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes('CREDIT_CARD_PAYMENT'))) {
        return 'loan';
    }
    if (detailed === null || detailed === void 0 ? void 0 : detailed.includes('TAX')) {
        return 'tax';
    }
    if (stream.frequency === 'MONTHLY' || stream.frequency === 'ANNUALLY') {
        return 'subscription';
    }
    return 'other';
}
/**
 * Determine if expense is essential based on Plaid category
 *
 * Legacy field maintained for backward compatibility with existing UI/logic.
 */
function isEssentialExpense(stream) {
    var _a, _b, _c, _d;
    const primary = (_b = (_a = stream.personal_finance_category) === null || _a === void 0 ? void 0 : _a.primary) === null || _b === void 0 ? void 0 : _b.toUpperCase();
    const detailed = (_d = (_c = stream.personal_finance_category) === null || _c === void 0 ? void 0 : _c.detailed) === null || _d === void 0 ? void 0 : _d.toUpperCase();
    const essentialCategories = [
        'RENT',
        'MORTGAGE',
        'UTILITIES',
        'ELECTRIC',
        'GAS',
        'WATER',
        'INSURANCE',
        'LOAN',
        'HEALTHCARE',
        'MEDICAL',
        'PHARMACY',
        'FOOD_AND_DRINK_GROCERIES'
    ];
    return essentialCategories.some(cat => (primary === null || primary === void 0 ? void 0 : primary.includes(cat)) || (detailed === null || detailed === void 0 ? void 0 : detailed.includes(cat)));
}
//# sourceMappingURL=formatRecurringOutflows.js.map