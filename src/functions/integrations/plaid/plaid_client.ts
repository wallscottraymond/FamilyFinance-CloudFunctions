/**
 * Plaid Integration Client
 *
 * Handles Plaid API calls with retry logic and error handling.
 * This is the ONLY place that makes direct Plaid API calls.
 *
 * @module integrations/plaid/plaid_client
 */

import {
  PlaidApi,
  Configuration,
  PlaidEnvironments,
  AccountBase,
  LinkTokenCreateRequest,
  LinkTokenCreateResponse,
  ItemPublicTokenExchangeResponse,
  TransactionsSyncResponse,
  TransactionsRecurringGetResponse,
  Products,
  CountryCode,
  DepositoryAccountSubtype,
  CreditAccountSubtype,
  InvestmentAccountSubtype,
} from "plaid";
import { PlaidCreateLinkTokenInput } from "../../types/plaid";
import { defineSecret, defineString } from "firebase-functions/params";

// Plaid credentials - use secrets for sensitive data
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
// Environment can use defineString with default since it's not sensitive
const PLAID_ENV = defineString("PLAID_ENV", { default: "sandbox" });

/**
 * Maximum retry attempts for Plaid API calls.
 */
const MAX_RETRIES = 3;

/**
 * Base delay for exponential backoff (ms).
 */
const BASE_DELAY_MS = 1000;

/**
 * Result of fetching accounts from Plaid. `accounts` are the RAW Plaid SDK
 * objects (`AccountBase`) — map them to domain via the transformer
 * `plaid_accounts_to_data`. The client never maps data itself.
 */
export interface PlaidAccountsResult {
  accounts: AccountBase[];
  item_id: string;
  request_id: string;
}

/**
 * Institution information from Plaid.
 */
export interface PlaidInstitutionInfo {
  institution_id: string;
  name: string;
}

/**
 * Memoized client — the config (env + secrets) is constant for the life of an
 * instance, so build the PlaidApi once and reuse it across warm invocations
 * instead of reconstructing Configuration + PlaidApi on every call.
 */
let cached_client: PlaidApi | null = null;

/**
 * Returns the configured Plaid API client, building it on first use.
 */
function create_plaid_client(): PlaidApi {
  if (cached_client) {
    return cached_client;
  }

  const env = PLAID_ENV.value();
  const plaid_env = env === "production"
    ? PlaidEnvironments.production
    : env === "development"
      ? PlaidEnvironments.development
      : PlaidEnvironments.sandbox;

  const configuration = new Configuration({
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

  cached_client = new PlaidApi(configuration);
  return cached_client;
}

/**
 * Executes an operation with exponential backoff retry.
 */
async function with_retry<T>(
  operation: () => Promise<T>,
  max_retries: number = MAX_RETRIES
): Promise<T> {
  let last_error: Error | undefined;

  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      last_error = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (4xx) except rate limits (429)
      const status = (error as { response?: { status?: number } })?.response?.status;
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

  throw last_error ?? new Error("Unknown error during Plaid API call");
}

/**
 * Fetches accounts from Plaid for a given access token.
 *
 * @param access_token - Decrypted Plaid access token
 * @returns Account data from Plaid
 */
export async function fetch_plaid_accounts(
  access_token: string
): Promise<PlaidAccountsResult> {
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
export async function get_institution_by_id(
  institution_id: string
): Promise<{ logo: string | null; primary_color: string | null; url: string | null }> {
  const client = create_plaid_client();

  const response = await with_retry(async () => {
    return client.institutionsGetById({
      /* eslint-disable @typescript-eslint/naming-convention */
      institution_id,
      country_codes: [CountryCode.Us],
      options: { include_optional_metadata: true },
      /* eslint-enable @typescript-eslint/naming-convention */
    });
  });

  const institution = response.data.institution;
  return {
    logo: institution.logo ?? null,
    primary_color: institution.primary_color ?? null,
    url: institution.url ?? null,
  };
}

/**
 * Fetches account balances from Plaid (for balance refresh).
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch
 * @returns Account data with fresh balances
 */
export async function fetch_plaid_balances(
  access_token: string,
  account_ids?: string[]
): Promise<PlaidAccountsResult> {
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
 * Creates a Plaid Link token for initializing Plaid Link.
 *
 * Returns the RAW Plaid SDK response (LinkTokenCreateResponse).
 * Transformation to domain format is done by the transformer.
 *
 * @param input - User and configuration data
 * @returns Raw Plaid LinkTokenCreateResponse
 */
export async function create_link_token(
  input: PlaidCreateLinkTokenInput
): Promise<LinkTokenCreateResponse> {
  const client = create_plaid_client();

  /* eslint-disable @typescript-eslint/naming-convention */
  const request: LinkTokenCreateRequest = {
    client_name: "Family Finance",
    language: "en",
    country_codes: [CountryCode.Us],
    user: {
      client_user_id: input.user_id,
      legal_name: input.user_name,
      email_address: input.user_email || undefined,
    },
    products: [Products.Transactions, Products.Auth],
    account_filters: {
      depository: {
        account_subtypes: [
          DepositoryAccountSubtype.Checking,
          DepositoryAccountSubtype.Savings,
          DepositoryAccountSubtype.MoneyMarket,
          DepositoryAccountSubtype.Cd,
        ],
      },
      credit: {
        account_subtypes: [CreditAccountSubtype.CreditCard],
      },
      investment: {
        account_subtypes: [
          InvestmentAccountSubtype._401k,
          InvestmentAccountSubtype._403B,
          InvestmentAccountSubtype.Ira,
          InvestmentAccountSubtype.Roth,
          InvestmentAccountSubtype.Brokerage,
        ],
      },
    },
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
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
export async function exchange_public_token(
  public_token: string
): Promise<ItemPublicTokenExchangeResponse> {
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
export async function sync_transactions(
  access_token: string,
  cursor?: string | null,
  count: number = 500
): Promise<TransactionsSyncResponse> {
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
export async function fetch_recurring_transactions(
  access_token: string,
  account_ids?: string[]
): Promise<TransactionsRecurringGetResponse> {
  const client = create_plaid_client();

  return with_retry(async () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const response = await client.transactionsRecurringGet({
      access_token,
      account_ids: account_ids?.length ? account_ids : undefined,
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    return response.data; // Return RAW SDK type
  });
}

/**
 * Result of removing a Plaid item.
 */
export interface RemoveItemResult {
  /** Whether the removal was successful */
  success: boolean;

  /** Plaid request ID for debugging */
  request_id: string;

  /** Whether the item was already removed (idempotent case) */
  already_removed: boolean;
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
export async function remove_item(
  access_token: string
): Promise<RemoveItemResult> {
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
  } catch (error) {
    // Handle "item not found" gracefully - it may already be removed
    const plaid_error = error as {
      response?: {
        data?: {
          error_code?: string;
          request_id?: string;
        };
      };
    };

    const error_code = plaid_error.response?.data?.error_code;
    const request_id = plaid_error.response?.data?.request_id || "unknown";

    // ITEM_NOT_FOUND means it's already been removed - treat as success
    if (error_code === "ITEM_NOT_FOUND") {
      console.log(
        `[plaid_client.remove_item] Item already removed (ITEM_NOT_FOUND), treating as success`
      );
      return {
        success: true,
        request_id,
        already_removed: true,
      };
    }

    // INVALID_ACCESS_TOKEN can also mean the item was removed
    if (error_code === "INVALID_ACCESS_TOKEN") {
      console.log(
        `[plaid_client.remove_item] Invalid access token, item may already be removed`
      );
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
