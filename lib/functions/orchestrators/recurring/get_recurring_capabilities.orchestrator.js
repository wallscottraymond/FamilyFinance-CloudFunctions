"use strict";
/**
 * Recurring capabilities (Convert-To-Recurring Phase 2): the app can't read `_feature_flags`, so it
 * asks. Returns ONLY `{enabled}` — nothing else about the flag, the rollout or other users.
 *
 * @module orchestrators/recurring/get_recurring_capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_recurring_capabilities_orchestrator = get_recurring_capabilities_orchestrator;
const feature_flags_1 = require("../../infrastructure/feature_flags");
async function get_recurring_capabilities_orchestrator(_ctx, user_id) {
    return { enabled: await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id) };
}
//# sourceMappingURL=get_recurring_capabilities.orchestrator.js.map