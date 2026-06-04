/**
 * User Repository
 *
 * READ-ONLY persistence boundary for the `users` collection. Currently only
 * exposes the enumeration the assignment backfill needs (all user doc IDs).
 *
 * @module repositories/user
 */
import { TraceContext } from "../types";
export declare const user_repo: {
    /**
     * Enumerate all user IDs (doc IDs of the `users` collection). Uses a
     * field-mask `select()` so only document refs are read, not full bodies.
     */
    get_all_ids(ctx: TraceContext): Promise<string[]>;
};
//# sourceMappingURL=user.repo.d.ts.map