"use strict";
/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing).
 *
 * - `get_recurring_detail_orchestrator`: a bill / income period + the definition fields its
 *   detail screen shows, for the owner or a member of the group its account is shared with
 *   (members can't read these docs from the app). READ-ONLY.
 * - `set_recurring_note_orchestrator`: set or clear a period's note, or an income's every-month
 *   note. One shared note: the owner and the group see the same text.
 *
 * Notes aren't derive inputs (no derive-version bump).
 *
 * @module orchestrators/recurring/recurring_note
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_recurring_detail_orchestrator = get_recurring_detail_orchestrator;
exports.set_recurring_note_orchestrator = set_recurring_note_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const recurring_access_resolver_1 = require("../../resolvers/recurring/recurring_access.resolver");
const recurring_note_service_1 = require("../../domain/recurring/recurring_note.service");
const recurring_note_repo_1 = require("../../repositories/recurring_note.repo");
async function get_recurring_detail_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_recurring_detail");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const deps = await (0, recurring_access_resolver_1.resolve_recurring_detail_deps)(ctx, user_id, input.kind, input.period_id);
        const result = {
            recurring_id: deps.recurring_id,
            period: (0, recurring_note_service_1.to_client)(deps.period),
            definition: (0, recurring_note_service_1.to_client)((0, recurring_note_service_1.pick_definition_fields)(input.kind, deps.definition)),
            via_group_id: deps.access.via_group_id,
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return result;
    }
    catch (e) {
        (0, observability_1.log_operation_error)(span, e);
        throw e;
    }
}
async function set_recurring_note_orchestrator(ctx, user_id, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "set_recurring_note");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        if (input.scope === "income" && input.kind !== "inflow") {
            throw new types_1.ValidationError(["Only income has an every-month note"]);
        }
        const period_id = input.scope === "period" ? input.period_id : null;
        if (input.scope === "period" && !period_id) {
            throw new types_1.ValidationError(["period_id is required"]);
        }
        const deps = await (0, recurring_access_resolver_1.resolve_recurring_note_deps)(ctx, user_id, input.kind, input.recurring_id, period_id);
        if (deps.period && !(0, recurring_note_service_1.period_belongs_to)(input.kind, deps.period, input.recurring_id)) {
            throw new types_1.PermissionDeniedError("note", `period ${period_id}`);
        }
        const note = (0, recurring_note_service_1.normalize_note)(input.note);
        if (note.validation_errors)
            throw new types_1.ValidationError(note.validation_errors);
        const text = (_a = note.entity) !== null && _a !== void 0 ? _a : "";
        if (period_id) {
            await recurring_note_repo_1.recurring_note_repo.set_period_note(ctx, input.kind, period_id, text);
        }
        else {
            await recurring_note_repo_1.recurring_note_repo.set_income_note(ctx, input.recurring_id, text);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return { note: text };
    }
    catch (e) {
        (0, observability_1.log_operation_error)(span, e);
        throw e;
    }
}
//# sourceMappingURL=recurring_note.orchestrator.js.map