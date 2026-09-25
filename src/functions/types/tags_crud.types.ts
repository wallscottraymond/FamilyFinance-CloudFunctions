/**
 * Tag CRUD — Zod input schemas + response types for the catalog callables.
 */

import { z } from "zod";
import { Tag } from "./tags.types";

/** Max tags per user — bounds the catalog (rule #9). */
export const MAX_TAGS_PER_USER = 100;

export const create_tag_input_schema = z.object({
  name: z.string().min(1, "name is required").max(40),
  color: z.string().min(1).max(20),
});
export type CreateTagInput = z.infer<typeof create_tag_input_schema>;

export const update_tag_input_schema = z.object({
  tag_id: z.string().min(1),
  name: z.string().min(1).max(40).optional(),
  color: z.string().min(1).max(20).optional(),
});
export type UpdateTagInput = z.infer<typeof update_tag_input_schema>;

export const delete_tag_input_schema = z.object({
  tag_id: z.string().min(1),
});

export interface CreateTagResponse {
  tag_id: string;
}
export interface ListTagsResponse {
  tags: Tag[];
}
