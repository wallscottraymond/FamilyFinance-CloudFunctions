"use strict";
/**
 * Join-waitlist orchestrator (Website-Waitlist)
 *
 * Resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 * The doc id comes from the email, so a double submit can't create two entries.
 *
 * @module orchestrators/waitlist/join_waitlist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.join_waitlist_orchestrator = join_waitlist_orchestrator;
const observability_1 = require("../../observability");
const waitlist_repo_1 = require("../../repositories/waitlist.repo");
const waitlist_resolver_1 = require("../../resolvers/waitlist/waitlist.resolver");
const waitlist_service_1 = require("../../domain/waitlist/waitlist.service");
async function join_waitlist_orchestrator(ctx, input, ip, now_ms = Date.now()) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "join_waitlist");
    (0, observability_1.log_operation_start)(span, "public");
    // The honeypot was filled: answer like a success so the bot learns nothing, and store nothing.
    if (input.company) {
        (0, observability_1.log_operation_success)(span, "public");
        return "ignored";
    }
    (0, waitlist_resolver_1.resolve_join_waitlist_dependencies)(ctx);
    const planned = await waitlist_repo_1.waitlist_repo.join_in_transaction(ctx, (0, waitlist_service_1.entry_id)(input.email), (0, waitlist_service_1.ip_limit_id)(ip, (0, waitlist_service_1.utc_day)(now_ms)), (state) => (0, waitlist_service_1.plan_join)(input, state, now_ms));
    (0, observability_1.log_operation_success)(span, "public");
    return planned.status;
}
//# sourceMappingURL=join_waitlist.orchestrator.js.map