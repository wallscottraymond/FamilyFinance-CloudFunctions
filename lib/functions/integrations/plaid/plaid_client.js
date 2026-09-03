"use strict";
/**
 * Plaid Integration Client
 *
 * Handles Plaid API calls with retry logic and error handling.
 * This is the ONLY place that makes direct Plaid API calls.
 *
 * @module integrations/plaid/plaid_client
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_webhook_verification_key = get_webhook_verification_key;
exports.fetch_plaid_accounts = fetch_plaid_accounts;
exports.get_institution_by_id = get_institution_by_id;
exports.fetch_plaid_balances = fetch_plaid_balances;
exports.fetch_plaid_liabilities = fetch_plaid_liabilities;
exports.safe_fetch_liabilities = safe_fetch_liabilities;
exports.create_link_token = create_link_token;
exports.exchange_public_token = exchange_public_token;
exports.sync_transactions = sync_transactions;
exports.fetch_recurring_transactions = fetch_recurring_transactions;
exports.remove_item = remove_item;
const plaid_1 = require("plaid");
const params_1 = require("firebase-functions/params");
// Plaid credentials - use secrets for sensitive data
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
// Environment can use defineString with default since it's not sensitive
const PLAID_ENV = (0, params_1.defineString)("PLAID_ENV", { default: "sandbox" });
/**
 * Maximum retry attempts for Plaid API calls.
 */
const MAX_RETRIES = 3;
/**
 * Base delay for exponential backoff (ms).
 */
const BASE_DELAY_MS = 1000;
/**
 * Memoized client — the config (env + secrets) is constant for the life of an
 * instance, so build the PlaidApi once and reuse it across warm invocations
 * instead of reconstructing Configuration + PlaidApi on every call.
 */
let cached_client = null;
/**
 * Returns the configured Plaid API client, building it on first use.
 */
function create_plaid_client() {
    if (cached_client) {
        return cached_client;
    }
    const env = PLAID_ENV.value();
    const plaid_env = env === "production"
        ? plaid_1.PlaidEnvironments.production
        : env === "development"
            ? plaid_1.PlaidEnvironments.development
            : plaid_1.PlaidEnvironments.sandbox;
    const configuration = new plaid_1.Configuration({
        basePath: plaid_env,
        baseOptions: {
            headers: {
                /* eslint-disable @typescript-eslint/naming-convention */
                "PLAID-CLIENT-ID": PLAID_CLIENT_ID.value(),
                "PLAID-SECRET": PLAID_SECRET.value(),
                /* eslint-enable @typescript-eslint/naming-convention */
            },
        },
    });
    cached_client = new plaid_1.PlaidApi(configuration);
    return cached_client;
}
/**
 * Executes an operation with exponential backoff retry.
 */
async function with_retry(operation, max_retries = MAX_RETRIES) {
    var _a;
    let last_error;
    for (let attempt = 0; attempt <= max_retries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            last_error = error instanceof Error ? error : new Error(String(error));
            // Don't retry on client errors (4xx) except rate limits (429)
            const status = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
            if (status && status >= 400 && status < 500 && status !== 429) {
                throw last_error;
            }
            // Don't retry on last attempt
            if (attempt === max_retries) {
                break;
            }
            // Exponential backoff with jitter
            const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw last_error !== null && last_error !== void 0 ? last_error : new Error("Unknown error during Plaid API call");
}
/**
 * Fetches the JWK used to verify a Plaid webhook JWS, by key id (the JWT `kid`).
 * Returns the raw JWK from Plaid's /webhook_verification_key/get — the caller
 * imports it as a public key and verifies the ES256 signature.
 */
async function get_webhook_verification_key(key_id) {
    const client = create_plaid_client();
    return with_retry(async () => {
        const response = await client.webhookVerificationKeyGet({ key_id });
        return response.data.key;
    });
}
/**
 * Fetches accounts from Plaid for a given access token.
 *
 * @param access_token - Decrypted Plaid access token
 * @returns Account data from Plaid
 */
async function fetch_plaid_accounts(access_token) {
    const client = create_plaid_client();
    const response = await with_retry(async () => {
        return client.accountsGet({
            /* eslint-disable @typescript-eslint/naming-convention */
            access_token,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    });
    // Return RAW Plaid SDK accounts — mapping happens in the transformer.
    return {
        accounts: response.data.accounts,
        item_id: response.data.item.item_id,
        request_id: response.data.request_id,
    };
}
/**
 * Fetches an institution's optional metadata (logo, primary color, url) by id.
 * Used at link time to capture the institution logo (a base64 PNG). Best-effort —
 * callers should tolerate a null logo and never fail the link on this.
 */
async function get_institution_by_id(institution_id) {
    var _a, _b, _c;
    const client = create_plaid_client();
    const response = await with_retry(async () => {
        return client.institutionsGetById({
            /* eslint-disable @typescript-eslint/naming-convention */
            institution_id,
            country_codes: [plaid_1.CountryCode.Us],
            options: { include_optional_metadata: true },
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    });
    const institution = response.data.institution;
    return {
        logo: (_a = institution.logo) !== null && _a !== void 0 ? _a : null,
        primary_color: (_b = institution.primary_color) !== null && _b !== void 0 ? _b : null,
        url: (_c = institution.url) !== null && _c !== void 0 ? _c : null,
    };
}
/**
 * Fetches account balances from Plaid (for balance refresh).
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch
 * @returns Account data with fresh balances
 */
async function fetch_plaid_balances(access_token, account_ids) {
    const client = create_plaid_client();
    const response = await with_retry(async () => {
        return client.accountsBalanceGet({
            /* eslint-disable @typescript-eslint/naming-convention */
            access_token,
            options: account_ids ? { account_ids } : undefined,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    });
    // Return RAW Plaid SDK accounts — mapping happens in the transformer.
    return {
        accounts: response.data.accounts,
        item_id: response.data.item.item_id,
        request_id: response.data.request_id,
    };
}
/**
 * Fetches liability detail from Plaid (`/liabilities/get`) — Investments-And-
 * Liabilities-Modeling. Returns RAW Plaid SDK types; mapping happens in the
 * transformer.
 *
 * THROWS if the item wasn't linked with the Liabilities product (Plaid error
 * `PRODUCTS_NOT_SUPPORTED` / `INVALID_PRODUCT`) — callers MUST catch and skip so a
 * cash-only item doesn't fail the whole sync.
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch
 */
async function fetch_plaid_liabilities(access_token, account_ids) {
    var _a;
    const client = create_plaid_client();
    const response = await with_retry(async () => {
        return client.liabilitiesGet({
            /* eslint-disable @typescript-eslint/naming-convention */
            access_token,
            options: account_ids ? { account_ids } : undefined,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
    });
    return {
        liabilities: (_a = response.data.liabilities) !== null && _a !== void 0 ? _a : null,
        request_id: response.data.request_id,
    };
}
/**
 * Fetches liabilities but NEVER throws — returns the raw liabilities object, or
 * `null` when the item wasn't linked with the Liabilities product (the common
 * case: cash-only items) or any other error. Lets the sync attach liabilities when
 * available without ever failing the whole sync over a cash item.
 *
 * @param access_token - Decrypted Plaid access token
 * @param trace_id - For logging the skip reason
 */
async function safe_fetch_liabilities(access_token, trace_id) {
    var _a, _b, _c;
    try {
        const result = await fetch_plaid_liabilities(access_token);
        return result.liabilities;
    }
    catch (error) {
        // PRODUCTS_NOT_SUPPORTED / INVALID_PRODUCT for cash-only items is EXPECTED —
        // not an error worth failing the sync. Log at debug and move on.
        const code = (_c = (_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code) !== null && _c !== void 0 ? _c : "UNKNOWN";
        console.log(`[${trace_id}] safe_fetch_liabilities: skipping (${code}) — item likely has no Liabilities product`);
        return null;
    }
}
/**
 * Creates a Plaid Link token for initializing Plaid Link.
 *
 * Returns the RAW Plaid SDK response (LinkTokenCreateResponse).
 * Transformation to domain format is done by the transformer.
 *
 * @param input - User and configuration data
 * @returns Raw Plaid LinkTokenCreateResponse
 */
async function create_link_token(input) {
    var _a;
    const client = create_plaid_client();
    /* eslint-disable @typescript-eslint/naming-convention */
    // Two link flows (Investments-And-Liabilities-Modeling):
    //  - "cash" (default): asset accounts — depository + investment. `products:
    //    [Transactions]`. (Investments stay here so brokerages/401k remain linkable;
    //    their data isn't enriched until the Investments product ships.)
    //  - "liability": debt accounts — credit cards + ALL loan subtypes. Adds the
    //    `Liabilities` product so APR/statement/min/due come back. Credit cards move
    //    HERE (off the cash flow) so they get their liability detail.
    // Liabilities is only requested on the liability flow → we don't pay/consent for
    // it on every link. If Liabilities isn't dashboard-approved, this flow fails with
    // INVALID_PRODUCT (same gate as Auth — see below).
    const is_liability = ((_a = input.flow) !== null && _a !== void 0 ? _a : "cash") === "liability";
    const products = is_liability
        ? [plaid_1.Products.Transactions, plaid_1.Products.Liabilities]
        : [plaid_1.Products.Transactions];
    const account_filters = is_liability
        ? {
            credit: { account_subtypes: [plaid_1.CreditAccountSubtype.CreditCard] },
            // ALL loan subtypes (mortgage/student/auto/home equity/LOC/…). Only
            // credit/mortgage/student get Liabilities detail; the rest link balance-only.
            loan: { account_subtypes: [plaid_1.LoanAccountSubtype.All] },
        }
        : {
            depository: {
                account_subtypes: [
                    plaid_1.DepositoryAccountSubtype.Checking,
                    plaid_1.DepositoryAccountSubtype.Savings,
                    plaid_1.DepositoryAccountSubtype.MoneyMarket,
                    plaid_1.DepositoryAccountSubtype.Cd,
                ],
            },
            investment: {
                account_subtypes: [
                    plaid_1.InvestmentAccountSubtype._401k,
                    plaid_1.InvestmentAccountSubtype._403B,
                    plaid_1.InvestmentAccountSubtype.Ira,
                    plaid_1.InvestmentAccountSubtype.Roth,
                    plaid_1.InvestmentAccountSubtype.Brokerage,
                ],
            },
        };
    const request = {
        client_name: "Family Finance",
        language: "en",
        country_codes: [plaid_1.CountryCode.Us],
        user: {
            client_user_id: input.user_id,
            legal_name: input.user_name,
            email_address: input.user_email || undefined,
        },
        // `transactions` is what a budgeting app needs (history + balances) and is
        // approved in Production. `auth` (account/routing numbers, for ACH) is NOT
        // enabled on this Plaid account in Production — requesting it makes
        // linkTokenCreate fail with INVALID_PRODUCT. Re-add Auth only after Plaid
        // approves it (dashboard.plaid.com/overview/request-products).
        products,
        // Pull the maximum history Plaid allows (730 days = 24 months) at link time.
        // Without this, Plaid defaults to ~90 days, which starves recurring-stream
        // detection (`transactionsRecurringGet` only sees the synced history) — so
        // bills/subscriptions with a monthly cadence rarely have enough occurrences
        // to be detected. NOTE: applies to NEWLY-linked items; existing items keep
        // whatever history they were linked with (re-link to extend).
        transactions: {
            days_requested: 730,
        },
        account_filters,
        webhook: process.env.PLAID_WEBHOOK_URL || undefined,
        // OAuth return (iOS Universal Link). Must be HTTPS + exact-match a URI
        // registered in the Plaid Dashboard. Server-authoritative (like webhook):
        // never trust a client-supplied redirect. Absent ⇒ OAuth disabled (non-OAuth
        // banks still link normally).
        redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    };
    // Update mode: use access_token instead of products
    // This is used for re-authentication when user credentials expire
    if (input.access_token) {
        delete request.products;
        request.access_token = input.access_token;
    }
    /* eslint-enable @typescript-eslint/naming-convention */
    return with_retry(async () => {
        const response = await client.linkTokenCreate(request);
        return response.data; // Return RAW SDK type
    });
}
/**
 * Exchanges a public token for an access token.
 *
 * Called after user completes Plaid Link. Returns RAW Plaid SDK response.
 * The access_token in the response should be encrypted before storage.
 *
 * @param public_token - The public token from Plaid Link
 * @returns Raw Plaid ItemPublicTokenExchangeResponse
 */
async function exchange_public_token(public_token) {
    const client = create_plaid_client();
    return with_retry(async () => {
        const response = await client.itemPublicTokenExchange({
            /* eslint-disable @typescript-eslint/naming-convention */
            public_token,
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        return response.data; // Return RAW SDK type
    });
}
/**
 * Syncs transactions from Plaid using the /transactions/sync endpoint.
 *
 * Returns the RAW Plaid SDK response (TransactionsSyncResponse).
 * The response includes:
 * - added: New transactions since last cursor
 * - modified: Transactions that were updated
 * - removed: Transaction IDs that were removed
 * - next_cursor: Cursor for next sync
 * - has_more: Whether there are more pages
 *
 * @param access_token - Decrypted Plaid access token
 * @param cursor - Optional cursor from previous sync (null for initial)
 * @param count - Number of transactions per page (max 500)
 * @returns Raw Plaid TransactionsSyncResponse
 */
async function sync_transactions(access_token, cursor, count = 500) {
    const client = create_plaid_client();
    return with_retry(async () => {
        /* eslint-disable @typescript-eslint/naming-convention */
        const response = await client.transactionsSync({
            access_token,
            cursor: cursor || undefined,
            count: Math.min(count, 500), // Plaid max is 500
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        return response.data; // Return RAW SDK type
    });
}
/**
 * Fetches recurring transactions from Plaid.
 *
 * Returns the RAW Plaid SDK response (TransactionsRecurringGetResponse).
 * The response includes:
 * - inflow_streams: Recurring income (positive amounts)
 * - outflow_streams: Recurring expenses (negative amounts)
 * - updated_datetime: When Plaid last updated this data
 * - request_id: Plaid request ID for debugging
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch recurring for
 * @returns Raw Plaid TransactionsRecurringGetResponse
 */
async function fetch_recurring_transactions(access_token, account_ids) {
    const client = create_plaid_client();
    return with_retry(async () => {
        /* eslint-disable @typescript-eslint/naming-convention */
        const response = await client.transactionsRecurringGet({
            access_token,
            account_ids: (account_ids === null || account_ids === void 0 ? void 0 : account_ids.length) ? account_ids : undefined,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        return response.data; // Return RAW SDK type
    });
}
/**
 * Removes a Plaid item (disconnects the institution link).
 *
 * This removes the ENTIRE item, which includes ALL accounts linked
 * to that institution. There is no Plaid API to remove a single account.
 *
 * After calling this:
 * - The access_token becomes invalid
 * - No more webhooks will be sent for this item
 * - All accounts under this item should be soft-deleted locally
 *
 * This operation is idempotent - if the item is already removed,
 * returns success with already_removed=true.
 *
 * @param access_token - Decrypted Plaid access token
 * @returns Result indicating success/failure
 */
async function remove_item(access_token) {
    var _a, _b, _c, _d;
    const client = create_plaid_client();
    try {
        const response = await with_retry(async () => {
            /* eslint-disable @typescript-eslint/naming-convention */
            const result = await client.itemRemove({
                access_token,
            });
            /* eslint-enable @typescript-eslint/naming-convention */
            return result.data;
        });
        return {
            success: true,
            request_id: response.request_id,
            already_removed: false,
        };
    }
    catch (error) {
        // Handle "item not found" gracefully - it may already be removed
        const plaid_error = error;
        const error_code = (_b = (_a = plaid_error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code;
        const request_id = ((_d = (_c = plaid_error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.request_id) || "unknown";
        // ITEM_NOT_FOUND means it's already been removed - treat as success
        if (error_code === "ITEM_NOT_FOUND") {
            console.log("[plaid_client.remove_item] Item already removed (ITEM_NOT_FOUND), treating as success");
            return {
                success: true,
                request_id,
                already_removed: true,
            };
        }
        // INVALID_ACCESS_TOKEN can also mean the item was removed
        if (error_code === "INVALID_ACCESS_TOKEN") {
            console.log("[plaid_client.remove_item] Invalid access token, item may already be removed");
            return {
                success: true,
                request_id,
                already_removed: true,
            };
        }
        // Re-throw other errors
        throw error;
    }
}
//# sourceMappingURL=plaid_client.js.map