"use strict";
/**
 * Tag CRUD — Zod input schemas + response types for the catalog callables.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_budget_tags_input_schema = exports.set_transaction_tags_input_schema = exports.MAX_TAGS_PER_ITEM = exports.delete_tag_input_schema = exports.update_tag_input_schema = exports.create_tag_input_schema = exports.MAX_TAGS_PER_USER = void 0;
const zod_1 = require("zod");
/** Max tags per user — bounds the catalog (rule #9). */
exports.MAX_TAGS_PER_USER = 100;
exports.create_tag_input_schema = zod_1.z.object({
    name: zod_1.z.string().min(1, "name is required").max(40),
    color: zod_1.z.string().min(1).max(20),
});
exports.update_tag_input_schema = zod_1.z.object({
    tag_id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1).max(40).optional(),
    color: zod_1.z.string().min(1).max(20).optional(),
});
exports.delete_tag_input_schema = zod_1.z.object({
    tag_id: zod_1.z.string().min(1),
});
/** Max tags applied to a single item (rule #9 — bounds the array). */
exports.MAX_TAGS_PER_ITEM = 10;
/**
 * Apply tags to a transaction. `split_id` null ⇒ whole transaction (every split gets the same
 * tags — the common single-split case); a value ⇒ that one split (multi-split advanced).
 */
exports.set_transaction_tags_input_schema = zod_1.z.object({
    transaction_id: zod_1.z.string().min(1),
    split_id: zod_1.z.string().min(1).nullable().optional(),
    tag_ids: zod_1.z.array(zod_1.z.string().min(1)).max(exports.MAX_TAGS_PER_ITEM),
});
/** Apply tags to a budget (top-level `tags`). */
exports.set_budget_tags_input_schema = zod_1.z.object({
    budget_id: zod_1.z.string().min(1),
    tag_ids: zod_1.z.array(zod_1.z.string().min(1)).max(exports.MAX_TAGS_PER_ITEM),
});
//# sourceMappingURL=tags_crud.types.js.map