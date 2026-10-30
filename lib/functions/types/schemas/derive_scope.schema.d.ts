/**
 * Derive scope input (Account-Rooted-Sharing): which view a derive callable computes.
 * Absent = Me (unchanged behavior). A group view requires membership (checked server-side).
 *
 * @module types/schemas/derive_scope
 */
import { z } from "zod";
export declare const derive_scope_schema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"me">;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"group">;
    group_id: z.ZodString;
}, z.core.$strip>], "kind">;
//# sourceMappingURL=derive_scope.schema.d.ts.map