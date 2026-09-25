/**
 * Tag CRUD — Zod input schemas + response types for the catalog callables.
 */
import { z } from "zod";
import { Tag } from "./tags.types";
/** Max tags per user — bounds the catalog (rule #9). */
export declare const MAX_TAGS_PER_USER = 100;
export declare const create_tag_input_schema: z.ZodObject<{
    name: z.ZodString;
    color: z.ZodString;
}, z.core.$strip>;
export type CreateTagInput = z.infer<typeof create_tag_input_schema>;
export declare const update_tag_input_schema: z.ZodObject<{
    tag_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateTagInput = z.infer<typeof update_tag_input_schema>;
export declare const delete_tag_input_schema: z.ZodObject<{
    tag_id: z.ZodString;
}, z.core.$strip>;
/** Max tags applied to a single item (rule #9 — bounds the array). */
export declare const MAX_TAGS_PER_ITEM = 10;
/**
 * Apply tags to a transaction. `split_id` null ⇒ whole transaction (every split gets the same
 * tags — the common single-split case); a value ⇒ that one split (multi-split advanced).
 */
export declare const set_transaction_tags_input_schema: z.ZodObject<{
    transaction_id: z.ZodString;
    split_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tag_ids: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type SetTransactionTagsInput = z.infer<typeof set_transaction_tags_input_schema>;
/** Apply tags to a budget (top-level `tags`). */
export declare const set_budget_tags_input_schema: z.ZodObject<{
    budget_id: z.ZodString;
    tag_ids: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type SetBudgetTagsInput = z.infer<typeof set_budget_tags_input_schema>;
export interface CreateTagResponse {
    tag_id: string;
}
export interface ListTagsResponse {
    tags: Tag[];
}
//# sourceMappingURL=tags_crud.types.d.ts.map