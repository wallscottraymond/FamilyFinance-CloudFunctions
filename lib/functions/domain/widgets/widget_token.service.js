"use strict";
/**
 * Widget token hashing ([[iOS-Home-Screen-Widgets]]). PURE + deterministic: the sha256 hex of a
 * widget token is the endpoint's lookup key; the raw token is never stored unencrypted.
 *
 * @module domain/widgets/widget_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash_widget_token = hash_widget_token;
const crypto_1 = require("crypto");
function hash_widget_token(token) {
    return (0, crypto_1.createHash)("sha256").update(token).digest("hex");
}
//# sourceMappingURL=widget_token.service.js.map