/**
 * Widget token hashing ([[iOS-Home-Screen-Widgets]]). PURE + deterministic: the sha256 hex of a
 * widget token is the endpoint's lookup key; the raw token is never stored unencrypted.
 *
 * @module domain/widgets/widget_token
 */

import { createHash } from "crypto";

export function hash_widget_token(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
