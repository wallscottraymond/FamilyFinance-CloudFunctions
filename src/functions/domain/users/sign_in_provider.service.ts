/**
 * Sign-in provider checks on a Firebase ID token ([[Sign-In-With-Apple]]). PURE.
 *
 * @module domain/users/sign_in_provider
 */

/** True when the caller signed in anonymously ("Try it without an account"). */
export function is_anonymous_sign_in(
  token: { firebase?: { sign_in_provider?: string } } | undefined
): boolean {
  return token?.firebase?.sign_in_provider === "anonymous";
}
