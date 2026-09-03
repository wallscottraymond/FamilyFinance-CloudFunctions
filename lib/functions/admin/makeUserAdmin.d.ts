/**
 * Grant admin role to a user.
 *
 * SECURITY: the CALLER must already be an admin. This prevents any
 * authenticated user from self-escalating to admin. The very first admin
 * must be bootstrapped out-of-band (Firebase console custom claim
 * `role: "admin"`, or the `users/{uid}.role` field + a token refresh).
 *
 * Target: defaults to the caller (re-affirm own admin); pass `data.targetUserId`
 * to promote another user.
 */
export declare const makeUserAdmin: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    userId: string;
    role: string;
}>, unknown>;
//# sourceMappingURL=makeUserAdmin.d.ts.map