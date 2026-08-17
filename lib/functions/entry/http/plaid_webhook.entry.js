"use strict";
/**
 * Plaid Webhook Entry Point
 *
 * HTTP endpoint for receiving Plaid webhook notifications.
 * Routes to appropriate orchestrators based on webhook type/code.
 *
 * Currently handles:
 * - ITEM.NEW_ACCOUNTS_AVAILABLE -> webhook_balance_sync_orchestrator
 *
 * Future handlers can be added for:
 * - TRANSACTIONS.SYNC_UPDATES_AVAILABLE -> transaction sync
 * - RECURRING_TRANSACTIONS.RECURRING_TRANSACTIONS_UPDATE -> recurring sync
 *
 * @module entry/http/plaid_webhook
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
exports.plaid_webhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const crypto = __importStar(require("crypto"));
const jwt = __importStar(require("jsonwebtoken"));
const observability_1 = require("../../observability");
const plaid_1 = require("../../orchestrators/plaid");
const plaid_client_1 = require("../../integrations/plaid/plaid_client");
// Plaid client credentials are needed to fetch webhook verification keys;
// tokenEncryptionKey is needed by downstream sync orchestrators. Plaid signs
// webhooks with a JWT (ES256) verified via public keys — there is NO shared
// webhook secret (the old PLAID_WEBHOOK_SECRET HMAC scheme was incorrect).
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
// Cache verification keys by `kid` (they rarely rotate). Refetched on a cache miss.
const key_cache = new Map();
/**
 * Verifies a Plaid webhook per Plaid's spec: the `plaid-verification` header is a
 * JWS (ES256). We read its `kid`, fetch the matching public key from Plaid's
 * /webhook_verification_key/get, verify the ES256 signature (rejecting anything
 * older than 5 min), then confirm the JWT's `request_body_sha256` claim equals the
 * SHA-256 of the RAW request body. Returns true only if all checks pass.
 */
async function verify_plaid_webhook(token, raw_body) {
    try {
        if (!token)
            return false;
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || typeof decoded === "string")
            return false;
        const { alg, kid } = decoded.header;
        if (alg !== "ES256" || !kid) {
            console.warn(`Webhook JWT rejected: alg=${alg} kid=${kid}`);
            return false;
        }
        let public_key = key_cache.get(kid);
        if (!public_key) {
            const jwk = await (0, plaid_client_1.get_webhook_verification_key)(kid);
            // Import only the EC public-key fields as a JWK.
            public_key = crypto.createPublicKey({
                key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
                format: "jwk",
            });
            key_cache.set(kid, public_key);
        }
        // Verify signature + freshness (iat within 5 minutes).
        const claims = jwt.verify(token, public_key, {
            algorithms: ["ES256"],
            // eslint-disable-next-line @typescript-eslint/naming-convention
            maxAge: "5m",
        });
        // Confirm the body hasn't been tampered with.
        const body_hash = crypto.createHash("sha256").update(raw_body).digest("hex");
        const claimed = String(claims.request_body_sha256 || "");
        if (claimed.length !== body_hash.length)
            return false;
        return crypto.timingSafeEqual(Buffer.from(claimed), Buffer.from(body_hash));
    }
    catch (error) {
        console.error("Error verifying Plaid webhook:", error);
        return false;
    }
}
/**
 * Plaid Webhook Handler
 *
 * Receives webhooks from Plaid and routes to appropriate orchestrators.
 * Follows architecture: Entry -> Orchestrator -> Resolver -> Domain -> Repository
 */
exports.plaid_webhook = (0, https_1.onRequest)(
/* eslint-disable @typescript-eslint/naming-convention */
{
    memory: "512MiB",
    timeoutSeconds: 30, // Webhooks need fast response
    cors: false, // Webhooks should not have CORS
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, 
/* eslint-enable @typescript-eslint/naming-convention */
async (req, res) => {
    var _a;
    // 1. METHOD CHECK
    if (req.method !== "POST") {
        res.status(405).json({ error: "Only POST requests allowed" });
        return;
    }
    // 2. CREATE TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    const span_id = (0, observability_1.generate_id)();
    // 3. EXTRACT WEBHOOK DATA
    // Use the RAW body bytes for hash verification (JSON.stringify would reorder keys).
    const raw_body = (_a = req.rawBody) !== null && _a !== void 0 ? _a : Buffer.from(JSON.stringify(req.body));
    const signature = req.get("plaid-verification") || "";
    const { webhook_type, webhook_code, item_id: plaid_item_id, request_id, } = req.body;
    console.log(`[${trace_id}] Plaid webhook received: type=${webhook_type}, ` +
        `code=${webhook_code}, item=${plaid_item_id}`);
    // 4. VERIFY WEBHOOK SIGNATURE
    const should_verify = process.env.NODE_ENV === "production" ||
        process.env.VERIFY_WEBHOOK_SIGNATURE === "true";
    if (should_verify) {
        if (!(await verify_plaid_webhook(signature, raw_body))) {
            console.warn(`[${trace_id}] Invalid webhook signature`);
            res.status(401).json({
                success: false,
                error: "Invalid webhook signature",
            });
            return;
        }
        console.log(`[${trace_id}] Webhook signature verified`);
    }
    else {
        console.log(`[${trace_id}] Webhook signature verification skipped (development)`);
    }
    // 5. CALL THE ROUTING ORCHESTRATOR (one orchestrator owns the fan-out)
    try {
        const result = await (0, plaid_1.route_plaid_webhook_orchestrator)({ trace_id, span_id }, {
            webhook_type,
            webhook_code,
            plaid_item_id,
            request_id,
            webhook_body: req.body,
        });
        // 6. RETURN SUCCESS
        res.status(200).json({
            success: true,
            processed: result.processed,
            message: result.message,
            trace_id,
        });
    }
    catch (error) {
        console.error(`[${trace_id}] Webhook processing error:`, error);
        // Still return 200 to prevent Plaid from retrying for system errors
        res.status(200).json({
            success: false,
            error: "Internal processing error",
            trace_id,
        });
    }
});
// Webhook routing (type/code switch + resolver + sub-orchestrator fan-out) now
// lives in `orchestrators/plaid/route_plaid_webhook.orchestrator.ts`. The entry
// keeps only protocol concerns: method check, signature verification, trace
// creation, and response mapping.
//# sourceMappingURL=plaid_webhook.entry.js.map