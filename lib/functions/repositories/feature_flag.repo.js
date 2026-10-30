"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feature_flag_repo = void 0;
/**
 * Feature Flag Repository — READ-ONLY boundary over `_feature_flags` for resolvers (which may only
 * read through repositories). Delegates to the per-instance cached flag loader in
 * `infrastructure/feature_flags` (one collection read per instance per TTL, shared with every
 * other flag check on that instance).
 *
 * @module repositories/feature_flag
 */
const feature_flags_1 = require("../infrastructure/feature_flags");
exports.feature_flag_repo = {
    /** Convert-To-Recurring capture-rules flag for this user (cached; never throws; problem = off). */
    async is_convert_to_recurring_enabled(user_id) {
        try {
            return await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id);
        }
        catch (_a) {
            return false;
        }
    },
};
//# sourceMappingURL=feature_flag.repo.js.map