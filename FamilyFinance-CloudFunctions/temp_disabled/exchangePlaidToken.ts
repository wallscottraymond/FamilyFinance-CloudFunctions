import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Configuration, PlaidApi, PlaidEnvironments, ItemPublicTokenExchangeRequest } from "plaid";
import { 
  UserRole,
  PlaidItem,
  PlaidAccount,
  PlaidProduct,
  PlaidItemStatus,
  PlaidUpdateMode,
  PlaidAccountType,
  PlaidAccountSubtype,
  FunctionResponse
} from "../../types";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";
import { encryptAccessToken } from "../../utils/plaidSecurity";

/**
 * Plaid Configuration
 */
const PLAID_CLIENT_ID = "6439737b3f59d500139a7d13";
const PLAID_SECRET = "095fcb3d97498b9cddaf4b4f3d4056"; // Sandbox key
const PLAID_ENV = PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath: PLAID_ENV,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);
const db = getFirestore();

/**
 * Exchange Plaid public token for access token and store account information
 * Uses Promise wrapping pattern as requested
 */
export const exchangePlaidToken = onRequest({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.EDITOR);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Validate request body
      const { publicToken, institutionId, institutionName, accounts } = request.body;

      if (!publicToken || !institutionId || !institutionName) {
        return response.status(400).json(
          createErrorResponse(
            "invalid-request",
            "Missing required fields: publicToken, institutionId, institutionName"
          )
        );
      }

      // Use Promise wrapping pattern as requested
      function exchangeTokenProcess(resolve: Function, reject: Function) {
        (async () => {
          try {
            // Step 1: Exchange public token for access token
            const exchangeRequest: ItemPublicTokenExchangeRequest = {
              public_token: publicToken,
            };

            const exchangeResponse = await plaidClient.itemPublicTokenExchange(exchangeRequest);
            const accessToken = exchangeResponse.data.access_token;
            const itemId = exchangeResponse.data.item_id;

            // Step 2: Get item details
            const itemResponse = await plaidClient.itemGet({
              access_token: accessToken,
            });

            const item = itemResponse.data.item;

            // Step 3: Get accounts
            const accountsResponse = await plaidClient.accountsGet({
              access_token: accessToken,
            });

            const plaidAccounts = accountsResponse.data.accounts;

            // Step 4: Encrypt and store access token
            const encryptedAccessToken = encryptAccessToken(accessToken);

            // Step 5: Store Plaid item in Firestore
            const plaidItem: Omit<PlaidItem, 'id' | 'createdAt' | 'updatedAt'> = {
              itemId: itemId,
              userId: user.id!,
              familyId: user.familyId,
              institutionId: institutionId,
              institutionName: institutionName,
              institutionLogo: "", // Could be fetched from institution details
              accessToken: JSON.stringify(encryptedAccessToken), // Store as JSON string
              cursor: null, // Will be set during first transaction sync
              products: [PlaidProduct.TRANSACTIONS, PlaidProduct.ACCOUNTS],
              availableProducts: item.available_products || [],
              billedProducts: item.billed_products || [],
              status: PlaidItemStatus.GOOD,
              error: undefined,
              consentExpirationTime: item.consent_expiration_time ? 
                Timestamp.fromDate(new Date(item.consent_expiration_time)) : undefined,
              lastWebhookReceived: undefined,
              updateMode: PlaidUpdateMode.WEBHOOK,
              isActive: true
            };

            const itemRef = await db.collection('plaid_items').add({
              ...plaidItem,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });

            // Step 6: Store accounts
            const storedAccounts = [];
            
            for (const account of plaidAccounts) {
              const plaidAccount: Omit<PlaidAccount, 'id' | 'createdAt' | 'updatedAt'> = {
                accountId: account.account_id,
                itemId: itemId,
                userId: user.id!,
                familyId: user.familyId,
                persistentAccountId: account.persistent_account_id || undefined,
                name: account.name,
                mask: account.mask || undefined,
                officialName: account.official_name || undefined,
                type: mapPlaidAccountType(account.type),
                subtype: mapPlaidAccountSubtype(account.subtype),
                balances: {
                  available: account.balances.available,
                  current: account.balances.current,
                  limit: account.balances.limit || undefined,
                  isoCurrencyCode: account.balances.iso_currency_code || undefined,
                  unofficialCurrencyCode: account.balances.unofficial_currency_code || undefined,
                  lastUpdated: Timestamp.now()
                },
                verificationStatus: undefined, // Would be set if using Auth product
                isActive: true,
                isSyncEnabled: true, // Enable sync by default
                lastSyncedAt: undefined,
                metadata: {
                  institution: {
                    name: institutionName,
                    logo: "" // Could be fetched from institution details
                  },
                  linkedAt: Timestamp.now(),
                  lastBalanceUpdate: Timestamp.now()
                }
              };

              const accountRef = await db.collection('plaid_accounts').add({
                ...plaidAccount,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
              });

              storedAccounts.push({
                id: accountRef.id,
                accountId: account.account_id,
                name: account.name,
                mask: account.mask,
                type: account.type,
                subtype: account.subtype,
                balances: account.balances
              });
            }

            resolve({
              success: true,
              data: {
                itemId: itemId,
                institutionName: institutionName,
                accountsCount: storedAccounts.length,
                accounts: storedAccounts,
                status: "connected"
              }
            });

          } catch (error: any) {
            console.error("Error in exchange token process:", error);
            
            // Map Plaid errors to user-friendly messages
            let errorMessage = "Failed to connect bank account";
            let errorCode = "plaid-error";
            
            if (error.response?.data?.error_code) {
              const plaidErrorCode = error.response.data.error_code;
              switch (plaidErrorCode) {
                case "INVALID_PUBLIC_TOKEN":
                  errorMessage = "Invalid or expired link token. Please try linking your account again.";
                  errorCode = "invalid-token";
                  break;
                case "INSTITUTION_DOWN":
                  errorMessage = "Your bank is currently unavailable. Please try again later.";
                  errorCode = "institution-unavailable";
                  break;
                case "ITEM_LOGIN_REQUIRED":
                  errorMessage = "Please update your login credentials with your bank.";
                  errorCode = "login-required";
                  break;
                default:
                  errorMessage = `Bank connection failed: ${error.response.data.error_message || error.message}`;
              }
            }

            reject({
              success: false,
              error: {
                code: errorCode,
                message: errorMessage,
                details: {
                  plaidError: error.response?.data || error.message
                }
              }
            });
          }
        })();
      }

      // Execute with Promise wrapper
      const result = await new Promise(exchangeTokenProcess);

      if (result.success) {
        return response.status(200).json(createSuccessResponse(result.data));
      } else {
        return response.status(400).json(result);
      }

    } catch (error: any) {
      console.error("Error in exchangePlaidToken:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to exchange Plaid token")
      );
    }
  });
});

/**
 * Maps Plaid account type to our enum
 */
function mapPlaidAccountType(plaidType: string): PlaidAccountType {
  switch (plaidType.toLowerCase()) {
    case 'depository':
      return PlaidAccountType.DEPOSITORY;
    case 'credit':
      return PlaidAccountType.CREDIT;
    case 'loan':
      return PlaidAccountType.LOAN;
    case 'investment':
      return PlaidAccountType.INVESTMENT;
    default:
      return PlaidAccountType.OTHER;
  }
}

/**
 * Maps Plaid account subtype to our enum
 */
function mapPlaidAccountSubtype(plaidSubtype: string | null): PlaidAccountSubtype {
  if (!plaidSubtype) return PlaidAccountSubtype.OTHER;
  
  const subtype = plaidSubtype.toLowerCase().replace(/\s+/g, ' ');
  
  // Map common subtypes
  const subtypeMap: Record<string, PlaidAccountSubtype> = {
    'checking': PlaidAccountSubtype.CHECKING,
    'savings': PlaidAccountSubtype.SAVINGS,
    'hsa': PlaidAccountSubtype.HSA,
    'cd': PlaidAccountSubtype.CD,
    'money market': PlaidAccountSubtype.MONEY_MARKET,
    'paypal': PlaidAccountSubtype.PAYPAL,
    'prepaid': PlaidAccountSubtype.PREPAID,
    'credit card': PlaidAccountSubtype.CREDIT_CARD,
    'paypal credit': PlaidAccountSubtype.PAYPAL_CREDIT,
    'auto': PlaidAccountSubtype.AUTO,
    'commercial': PlaidAccountSubtype.COMMERCIAL,
    'construction': PlaidAccountSubtype.CONSTRUCTION,
    'consumer': PlaidAccountSubtype.CONSUMER,
    'home equity': PlaidAccountSubtype.HOME_EQUITY,
    'mortgage': PlaidAccountSubtype.MORTGAGE,
    'overdraft': PlaidAccountSubtype.OVERDRAFT,
    'line of credit': PlaidAccountSubtype.LINE_OF_CREDIT,
    'student': PlaidAccountSubtype.STUDENT,
    '401k': PlaidAccountSubtype.INVESTMENT_401K,
    '403b': PlaidAccountSubtype.INVESTMENT_403B,
    'ira': PlaidAccountSubtype.IRA,
    'brokerage': PlaidAccountSubtype.BROKERAGE,
    'roth': PlaidAccountSubtype.ROTH,
    'roth 401k': PlaidAccountSubtype.ROTH_401K
  };
  
  return subtypeMap[subtype] || PlaidAccountSubtype.OTHER;
}