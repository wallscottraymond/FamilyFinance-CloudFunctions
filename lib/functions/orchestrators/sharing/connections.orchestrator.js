"use strict";
/**
 * Connections Orchestrators (D27, D28)
 *
 * get_sharing_overview: everything the Groups screen shows, in one call.
 * manage_connection: nickname / disconnect / block / report.
 *
 * @module orchestrators/sharing/connections
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_sharing_overview_orchestrator = get_sharing_overview_orchestrator;
exports.manage_connection_orchestrator = manage_connection_orchestrator;
const observability_1 = require("../../observability");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const sharing_overview_service_1 = require("../../domain/sharing/sharing_overview.service");
const connection_service_1 = require("../../domain/sharing/connection.service");
const request_service_1 = require("../../domain/sharing/request.service");
const sharing_1 = require("../../repositories/sharing");
/** The Groups-screen read model. Read-only: no idempotency, no writes. */
async function get_sharing_overview_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_sharing_overview");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const deps = await (0, sharing_resolver_1.resolve_overview)(ctx, ctx.user_id);
    const overview = (0, sharing_overview_service_1.build_sharing_overview)(ctx.user_id, deps.connections, deps.groups, deps.requests, deps.request_groups, Date.now());
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return overview;
}
/**
 * Applies a connection action. Report = block + a report record (D27). Blocking
 * also cancels pending requests between the two people. Someone who isn't
 * connected can still be blocked if they sent the caller a request.
 */
async function manage_connection_orchestrator(ctx) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "manage_connection");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    const other = ctx.input.other_user_id;
    if (other === ctx.user_id)
        return { success: false, errors: ["That's you"] };
    // 1. RESOLVER
    const deps = await (0, sharing_resolver_1.resolve_connection_action)(ctx, ctx.user_id, other);
    // 2. DOMAIN
    const blocks = ctx.input.action === "block" || ctx.input.action === "report";
    const sent_me_a_request = deps.pending_between.some((r) => r.from_user_id === other);
    const connection = !deps.connection && blocks && sent_me_a_request
        ? (0, connection_service_1.build_block_without_connection)(ctx.user_id, other, now_ms)
        : deps.connection;
    const change = (0, connection_service_1.apply_connection_action)(connection, ctx.user_id, ctx.input.action === "set_nickname"
        ? { action: "set_nickname", nickname: ctx.input.nickname }
        : ctx.input.action === "disconnect"
            ? { action: "disconnect" }
            : { action: "block" });
    if (((_a = change.validation_errors) === null || _a === void 0 ? void 0 : _a.length) || !change.entity) {
        return { success: false, errors: change.validation_errors };
    }
    const report = ctx.input.action === "report"
        ? (0, request_service_1.build_report)(sharing_1.report_repo.new_id(), ctx.user_id, other, ctx.input.reason, now_ms)
        : null;
    if ((_b = report === null || report === void 0 ? void 0 : report.validation_errors) === null || _b === void 0 ? void 0 : _b.length) {
        return { success: false, errors: report.validation_errors };
    }
    const cancelled = blocks ? (0, request_service_1.cancel_requests)(deps.pending_between, now_ms) : [];
    // 3. REPOSITORY
    const next = change.entity.connection;
    if (next)
        await sharing_1.connection_repo.save(ctx, next, now_ms);
    else
        await sharing_1.connection_repo.delete(ctx, connection.id);
    await sharing_1.request_repo.save_many(ctx, cancelled);
    if (report === null || report === void 0 ? void 0 : report.entity)
        await sharing_1.report_repo.save(ctx, report.entity);
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true };
}
//# sourceMappingURL=connections.orchestrator.js.map