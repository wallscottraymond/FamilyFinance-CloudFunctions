/**
 * Sign-in provider checks on a Firebase ID token ([[Sign-In-With-Apple]]). PURE.
 *
 * @module domain/users/sign_in_provider
 */
/**
 * True when the caller is STILL anonymous ("Try it without an account"). An anonymous account
 * secured later (Apple / email linked to the same uid) can keep `sign_in_provider: "anonymous"`
 * on its session token, so a linked identity in `firebase.identities` means it's secured.
 */
export declare function is_anonymous_sign_in(token: {
    firebase?: {
        sign_in_provider?: string;
        identities?: Record<string, unknown>;
    };
} | undefined): boolean;
//# sourceMappingURL=sign_in_provider.service.d.ts.map