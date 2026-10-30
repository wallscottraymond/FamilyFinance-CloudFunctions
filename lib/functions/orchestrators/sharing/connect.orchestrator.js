"use strict";
/**
 * Connect Orchestrators (D24, D29)
 *
 * get_my_connect_code: shows (or issues) the caller's code.
 * enter_connect_code: the caller typed someone's code; connects when both have.
 *
 * @module orchestrators/sharing/connect
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_my_connect_code_orchestrator = get_my_connect_code_orchestrator;
exports.enter_connect_code_orchestrator = enter_connect_code_orchestrator;
const crypto_1 = require("crypto");
const observability_1 = require("../../observability");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const connect_code_service_1 = require("../../domain/sharing/connect_code.service");
const connection_service_1 = require("../../domain/sharing/connection.service");
const names_service_1 = require("../../domain/sharing/names.service");
const sharing_1 = require("../../repositories/sharing");
const MAX_CODE_ATTEMPTS = 3;
/** Returns the caller's current code, issuing a new one when needed. */
async function get_my_connect_code_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_my_connect_code");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    // 1. RESOLVER
    const { existing, connection_count } = await (0, sharing_resolver_1.resolve_my_code)(ctx, ctx.user_id);
    // 2. DOMAIN
    let entity = existing;
    if ((0, connect_code_service_1.should_issue_new_code)(existing, now_ms, ctx.input.refresh)) {
        let code = "";
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            code = (0, connect_code_service_1.build_code)(Array.from({ length: connect_code_service_1.CODE_LENGTH }, () => (0, crypto_1.randomInt)(connect_code_service_1.CODE_ALPHABET.length)));
            if (!(await (0, sharing_resolver_1.resolve_code_taken)(ctx, code, ctx.user_id, now_ms)))
                break;
        }
        entity = (0, connect_code_service_1.build_connect_code)(ctx.user_id, code, now_ms, existing);
        // 3. REPOSITORY
        await sharing_1.connect_code_repo.save(ctx, entity, now_ms);
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return {
        code: entity.code,
        expires_at_ms: entity.expires_at_ms,
        connection_count,
        connection_limit: connect_code_service_1.MAX_CONNECTIONS,
    };
}
/** Handles the caller typing someone else's code. */
async function enter_connect_code_orchestrator(ctx) {
    var _a, _b, _c, _d, _e, _f;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "enter_connect_code");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const now_ms = Date.now();
    const code = (0, connect_code_service_1.normalize_entered_code)(ctx.input.code);
    if (!code)
        return { outcome: "malformed", person: null };
    // 1. RESOLVER
    const deps = await (0, sharing_resolver_1.resolve_code_entry)(ctx, ctx.user_id, code, now_ms);
    // 2. DOMAIN
    const decision = (0, connect_code_service_1.evaluate_code_entry)({
        caller_id: ctx.user_id,
        now_ms,
        target: deps.target,
        caller_code: deps.caller_code,
        existing_connection_status: (_b = (_a = deps.existing_connection) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : null,
        caller_connection_count: deps.caller_connection_count,
        target_connection_count: deps.target_connection_count,
    });
    // 3. REPOSITORY
    if (decision.record_failure) {
        const next = (0, connect_code_service_1.apply_failure)((_d = (_c = deps.caller_code) === null || _c === void 0 ? void 0 : _c.failed_attempts) !== null && _d !== void 0 ? _d : 0, now_ms);
        await sharing_1.connect_code_repo.set_failure_state(ctx, ctx.user_id, next.failed_attempts, next.cooldown_until_ms, now_ms);
    }
    const other = decision.other_user_id;
    let outcome = decision.outcome;
    if (decision.record_entry && other) {
        await sharing_1.connect_code_repo.record_entry(ctx, other, ctx.user_id, now_ms);
        // Both typed at about the same time: each read before the other's entry landed. Look again
        // after writing ours. Of two crossing writes, the later one always sees the earlier one, so
        // at least one side connects here (the other sees it on its next overview poll).
        const fresh = await sharing_1.connect_code_repo.get_by_user(ctx, ctx.user_id);
        outcome = (0, connect_code_service_1.evaluate_code_entry)({
            caller_id: ctx.user_id,
            now_ms,
            target: deps.target,
            caller_code: fresh,
            existing_connection_status: (_f = (_e = deps.existing_connection) === null || _e === void 0 ? void 0 : _e.status) !== null && _f !== void 0 ? _f : null,
            caller_connection_count: deps.caller_connection_count,
            target_connection_count: deps.target_connection_count,
        }).outcome;
    }
    if (outcome === "connected" && other) {
        // Both sides can get here in the same instant: create once, never overwrite.
        const connection = (0, connection_service_1.build_connection)(ctx.user_id, other, now_ms);
        await sharing_1.connection_repo.create_if_absent(ctx, connection, now_ms);
        await sharing_1.connect_code_repo.expire_codes(ctx, [ctx.user_id, other], now_ms);
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    const show_person = other !== null && outcome !== "unavailable";
    return {
        outcome,
        person: show_person ? (0, names_service_1.person_view)(other, {}) : null,
    };
}
//# sourceMappingURL=connect.orchestrator.js.map