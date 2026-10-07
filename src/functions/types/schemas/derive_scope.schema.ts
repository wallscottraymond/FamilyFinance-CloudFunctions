/**
 * Derive scope input (Account-Rooted-Sharing): which view a derive callable computes.
 * Absent = Me (unchanged behavior). A group view requires membership (checked server-side).
 *
 * @module types/schemas/derive_scope
 */

import { z } from "zod";

export const derive_scope_schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("me") }),
  z.object({ kind: z.literal("group"), group_id: z.string().trim().min(1).max(128) }),
]);
