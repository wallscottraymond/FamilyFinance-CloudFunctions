"use strict";
/**
 * Derive scope input (Account-Rooted-Sharing): which view a derive callable computes.
 * Absent = Me (unchanged behavior). A group view requires membership (checked server-side).
 *
 * @module types/schemas/derive_scope
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_scope_schema = void 0;
const zod_1 = require("zod");
exports.derive_scope_schema = zod_1.z.discriminatedUnion("kind", [
    zod_1.z.object({ kind: zod_1.z.literal("me") }),
    zod_1.z.object({ kind: zod_1.z.literal("group"), group_id: zod_1.z.string().trim().min(1).max(128) }),
]);
//# sourceMappingURL=derive_scope.schema.js.map