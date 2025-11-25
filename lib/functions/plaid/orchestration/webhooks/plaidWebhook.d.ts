/**
 * Plaid Webhook Handler Cloud Function
 *
 * Handles real-time webhook notifications from Plaid following best practices:
 * - Fast response (< 10 seconds) with minimal processing
 * - Idempotent handling of duplicate and out-of-order webhooks
 * - Webhook signature verification using HMAC-SHA256
 * - Queue-based processing for heavy operations
 * - Proper error handling and retry logic
 *
 * Based on Plaid's webhook best practices:
 * https://plaid.com/docs/#webhooks
 *
 * Memory: 512MiB, Timeout: 60s
 * CORS: Disabled (webhook endpoint)
 */
/**
 * Plaid Webhook Handler
 */
/**
 * Plaid Webhook Handler - Fast, reliable webhook receiver
 * Following Plaid's best practices for webhook handling
 */
export declare const plaidWebhook: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=plaidWebhook.d.ts.map