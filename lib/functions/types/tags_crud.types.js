"use strict";
/**
 * Tag CRUD — Zod input schemas + response types for the catalog callables.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_tag_input_schema = exports.update_tag_input_schema = exports.create_tag_input_schema = exports.MAX_TAGS_PER_USER = void 0;
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
//# sourceMappingURL=tags_crud.types.js.map