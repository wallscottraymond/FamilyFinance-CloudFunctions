"use strict";
/**
 * Feedback orchestrators (Feedback-And-Questions)
 *
 * - send: resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 *   The client-made note id IS the idempotency key: a retried send finds its own note and returns
 *   "deduped" without writing, so no separate idempotency record is kept.
 * - Sent tab: the sender's own list (read-only).
 * - status: is the caller an inbox owner, and how many notes are unread (owner only).
 * - inbox: owner-only list / mark read / open-done / delete. A non-owner gets PERMISSION_DENIED
 *   and never reads a note.
 *
 * @module orchestrators/feedback/feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.submit_feedback_orchestrator = submit_feedback_orchestrator;
exports.list_my_feedback_orchestrator = list_my_feedback_orchestrator;
exports.feedback_status_orchestrator = feedback_status_orchestrator;
exports.feedback_inbox_orchestrator = feedback_inbox_orchestrator;
const observability_1 = require("../../observability");
const feedback_repo_1 = require("../../repositories/feedback.repo");
const feedback_resolver_1 = require("../../resolvers/feedback/feedback.resolver");
const feedback_service_1 = require("../../domain/feedback/feedback.service");
const feedback_types_1 = require("../../types/feedback.types");
async function submit_feedback_orchestrator(ctx, now_ms = Date.now()) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "submit_feedback");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    (0, feedback_resolver_1.resolve_submit_feedback_dependencies)(ctx);
    const outcome = await feedback_repo_1.feedback_repo.submit_in_transaction(ctx, ctx.user_id, ctx.input.note_id, (sender, note_exists) => {
        const plan = (0, feedback_service_1.plan_submit)(ctx.input, sender, note_exists, now_ms);
        if (plan.kind === "write") {
            return {
                write: { note: plan.note, sender: plan.sender },
                result: {
                    success: true,
                    data: { note_id: plan.note.id, deduped: false, remaining_today: plan.remaining_today },
                },
            };
        }
        if (plan.kind === "deduped") {
            return {
                write: null,
                result: {
                    success: true,
                    data: {
                        note_id: ctx.input.note_id,
                        deduped: true,
                        remaining_today: plan.remaining_today,
                    },
                },
            };
        }
        return {
            write: null,
            result: { success: false, code: plan.code, message: plan.message },
        };
    });
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return outcome;
}
async function list_my_feedback_orchestrator(ctx, user_id) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "list_my_feedback");
    (0, observability_1.log_operation_start)(span, user_id);
    const sender = await feedback_repo_1.feedback_repo.get_sender(ctx, user_id);
    const ids = (_a = sender === null || sender === void 0 ? void 0 : sender.note_ids) !== null && _a !== void 0 ? _a : [];
    const notes = ids.length > 0 ? await feedback_repo_1.feedback_repo.get_notes(ctx, ids) : [];
    (0, observability_1.log_operation_success)(span, user_id);
    return { notes: (0, feedback_service_1.to_my_items)(ids, notes) };
}
async function feedback_status_orchestrator(ctx, user_id) {
    const flag = await (0, feedback_resolver_1.resolve_inbox_flag)(ctx);
    if (!(0, feedback_service_1.is_inbox_owner)(flag, user_id))
        return { is_owner: false, inbox_unread: 0 };
    return { is_owner: true, inbox_unread: await feedback_repo_1.feedback_repo.count_unread(ctx) };
}
async function feedback_inbox_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", `feedback_inbox:${ctx.input.action}`);
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    const flag = await (0, feedback_resolver_1.resolve_inbox_flag)(ctx);
    if (!(0, feedback_service_1.is_inbox_owner)(flag, ctx.user_id)) {
        return { success: false, code: "PERMISSION_DENIED", message: "Not allowed" };
    }
    const input = ctx.input;
    let data;
    switch (input.action) {
        case "list": {
            const page = await feedback_repo_1.feedback_repo.list_inbox(ctx, input.status, input.type, feedback_types_1.MAX_INBOX_NOTES);
            data = { action: "list", notes: page.notes.map(feedback_service_1.to_inbox_item), truncated: page.truncated };
            break;
        }
        case "mark_read": {
            const changed = await feedback_repo_1.feedback_repo.update_note_fields(ctx, input.note_id, {
                read_by_owner: true,
            });
            data = { action: "mark_read", note_id: input.note_id, changed };
            break;
        }
        case "set_status": {
            // Done also counts as read: a note you closed shouldn't keep the badge up.
            const changed = await feedback_repo_1.feedback_repo.update_note_fields(ctx, input.note_id, Object.assign({ status: input.status }, (input.status === "done" ? { read_by_owner: true } : {})));
            data = { action: "set_status", note_id: input.note_id, changed };
            break;
        }
        case "delete": {
            const changed = await feedback_repo_1.feedback_repo.delete_note(ctx, input.note_id, (sender) => (0, feedback_service_1.after_owner_delete)(sender, input.note_id));
            data = { action: "delete", note_id: input.note_id, changed };
            break;
        }
    }
    (0, observability_1.log_operation_success)(span, ctx.user_id);
    return { success: true, data };
}
//# sourceMappingURL=feedback.orchestrator.js.map