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

/** Max tags applied to a single item (rule #9 — bounds the array). */
export const MAX_TAGS_PER_ITEM = 10;

/**
 * Apply tags to a transaction. `split_id` null ⇒ whole transaction (every split gets the same
 * tags — the common single-split case); a value ⇒ that one split (multi-split advanced).
 */
export const set_transaction_tags_input_schema = z.object({
  transaction_id: z.string().min(1),
  split_id: z.string().min(1).nullable().optional(),
  tag_ids: z.array(z.string().min(1)).max(MAX_TAGS_PER_ITEM),
});
export type SetTransactionTagsInput = z.infer<typeof set_transaction_tags_input_schema>;

/** Apply tags to a budget (top-level `tags`). */
export const set_budget_tags_input_schema = z.object({
  budget_id: z.string().min(1),
  tag_ids: z.array(z.string().min(1)).max(MAX_TAGS_PER_ITEM),
});
export type SetBudgetTagsInput = z.infer<typeof set_budget_tags_input_schema>;

export interface CreateTagResponse {
  tag_id: string;
}
export interface ListTagsResponse {
  tags: Tag[];
}
