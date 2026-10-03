"use strict";
/**
 * Get Widget Token Orchestrator ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Returns the account's read-only widget token, creating it on first use; `rotate` issues a
 * new one and revokes the old ("Reset widget access"). One token per account, stored
 * encrypted so every signed-in device of the account gets the SAME token (signing out on one
 * phone must not break the other phone's widgets).
 *
 * @module orchestrators/widgets/get_widget_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_widget_token_orchestrator = get_widget_token_orchestrator;
const crypto_1 = require("crypto");
const observability_1 = require("../../observability");
const widget_resolver_1 = require("../../resolvers/widgets/widget.resolver");
const widget_token_repo_1 = require("../../repositories/widget_token.repo");
const encryption_1 = require("../../../utils/encryption");
const widget_token_service_1 = require("../../domain/widgets/widget_token.service");
async function get_widget_token_orchestrator(ctx, user_id, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_widget_token");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const stored = await (0, widget_resolver_1.resolve_stored_widget_token)(user_id);
        if (stored && !input.rotate) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { token: (0, encryption_1.decryptFromStorage)(stored.encrypted_token) };
        }
        const token = (0, crypto_1.randomBytes)(32).toString("base64url"); // 256-bit, unguessable
        await widget_token_repo_1.widget_token_repo.save(user_id, { encrypted_token: (0, encryption_1.encryptForStorage)(token), token_hash: (0, widget_token_service_1.hash_widget_token)(token) }, (_a = stored === null || stored === void 0 ? void 0 : stored.token_hash) !== null && _a !== void 0 ? _a : null);
        (0, observability_1.log_operation_success)(span, user_id);
        return { token };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
        });
        throw error;
    }
}
//# sourceMappingURL=get_widget_token.orchestrator.js.map