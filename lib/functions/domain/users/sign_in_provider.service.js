"use strict";
/**
 * Sign-in provider checks on a Firebase ID token ([[Sign-In-With-Apple]]). PURE.
 *
 * @module domain/users/sign_in_provider
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.is_anonymous_sign_in = is_anonymous_sign_in;
/**
 * True when the caller is STILL anonymous ("Try it without an account"). An anonymous account
 * secured later (Apple / email linked to the same uid) can keep `sign_in_provider: "anonymous"`
 * on its session token, so a linked identity in `firebase.identities` means it's secured.
 */
function is_anonymous_sign_in(token) {
    var _a, _b;
    if (((_a = token === null || token === void 0 ? void 0 : token.firebase) === null || _a === void 0 ? void 0 : _a.sign_in_provider) !== "anonymous")
        return false;
    return Object.keys((_b = token.firebase.identities) !== null && _b !== void 0 ? _b : {}).length === 0;
}
//# sourceMappingURL=sign_in_provider.service.js.map