"use strict";
/**
 * Feedback Resolver (Feedback-And-Questions) — read-only.
 *
 * - A send touches nothing derived (no budgets, periods or caches), so it has no dependencies.
 * - Inbox calls need the owner allowlist flag; the domain decides what it means.
 *
 * @module resolvers/feedback/feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_submit_feedback_dependencies = resolve_submit_feedback_dependencies;
exports.resolve_inbox_flag = resolve_inbox_flag;
const dependency_1 = require("../../types/dependency");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const feedback_types_1 = require("../../types/feedback.types");
/** A note is standalone: nothing derived depends on it. */
function resolve_submit_feedback_dependencies(_ctx) {
    return (0, dependency_1.no_dependencies)();
}
/** The inbox allowlist flag; any read problem reads as "no flag" (= nobody is an owner). */
async function resolve_inbox_flag(_ctx) {
    try {
        return await (0, feature_flags_1.get_feature_flag)(feedback_types_1.FEEDBACK_INBOX_FLAG);
    }
    catch (error) {
        console.warn(`[feedback] ${feedback_types_1.FEEDBACK_INBOX_FLAG} unreadable; treating as no owner:`, error);
        return null;
    }
}
//# sourceMappingURL=feedback.resolver.js.map