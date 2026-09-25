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
export interface CreateTagResponse {
    tag_id: string;
}
export interface ListTagsResponse {
    tags: Tag[];
}
//# sourceMappingURL=tags_crud.types.d.ts.map