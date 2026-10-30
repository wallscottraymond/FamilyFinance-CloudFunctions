"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.load_review_state_if_relevant = load_review_state_if_relevant;
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const feature_flag_repo_1 = require("../../repositories/feature_flag.repo");
const capture_rules_1 = require("../../domain/recurring/capture_rules");
async function load_review_state_if_relevant(ctx, user_id, loaded_records, flag_on) {
    if (!user_id)
        return null;
    const relevant = loaded_records.some((r) => (0, capture_rules_1.is_v2_record)(r)) ||
        (await (flag_on !== null && flag_on !== void 0 ? flag_on : feature_flag_repo_1.feature_flag_repo.is_convert_to_recurring_enabled(user_id)));
    return relevant ? recurring_review_repo_1.recurring_review_repo.get_state(ctx, user_id) : null;
}
//# sourceMappingURL=review_holdout.resolver.js.map