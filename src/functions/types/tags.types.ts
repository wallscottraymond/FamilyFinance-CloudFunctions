/**
 * Tag catalog — type definitions.
 *
 * A user-defined tag (the managed catalog). Docs (transaction splits + budgets) store the tag's
 * stable `id` in their `tags[]`; name/color resolve from this catalog (so rename/recolor is a
 * catalog-only write). See `1 Projects/Tag-System.md`.
 */

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  /** A preset-palette color (hex string). */
  color: string;
}
