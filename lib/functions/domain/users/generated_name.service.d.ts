/**
 * Generated display names for accounts that share no name ([[Sign-In-With-Apple]]): Sign in with
 * Apple requests NO scopes (no name, no email) and anonymous accounts have none, so the app never
 * holds a real name. Friendly "Adjective Animal" (e.g. "Calm Otter"), DETERMINISTIC from the uid —
 * the same account always gets the same name (a re-run trigger can't rename it). Editable later.
 *
 * PURE: no IO.
 *
 * @module domain/users/generated_name
 */
/** "Adjective Animal" for a uid — same uid, same name. */
export declare function generated_display_name(uid: string): string;
//# sourceMappingURL=generated_name.service.d.ts.map