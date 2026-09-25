"use strict";
/**
 * clear_transaction_review — onCall entry to clear a transaction's Rules Engine review flags
 * (`needsReview`/`needsNote`) from the "Needs review" queue. Owner only.
 *
 * @module entry/callable/clear_transaction_review
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clear_transaction_review = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const schema = zod_1.z.object({ transaction_id: zod_1.z.string().min(1) });
exports.clear_transaction_review = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const existing = await repositories_1.transaction_repo.get_raw_by_id(ctx, parsed.data.transaction_id);
    if (!existing) {
        throw new https_1.HttpsError("not-found", "Transaction not found");
    }
    if (existing.data.ownerId !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your transaction");
    }
    await repositories_1.transaction_repo.clear_review_flags(ctx, existing.id);
    return { success: true };
});
//# sourceMappingURL=clear_transaction_review.entry.js.map