/**
 * Derive-version bumps for sharing changes (Account-Rooted-Sharing; derive caches)
 *
 * Moving an account between views (share / accept / unshare / leave / delete /
 * purge) changes what its owner's Me view and the group view count. Bumping the
 * owner's version invalidates their Me cache, and the group version fingerprint
 * includes every member's version, so the group view refreshes too.
 *
 * @module orchestrators/sharing/versions
 */

import { bump_derive_version } from "../../repositories/derive_version.repo";

/** Bumps each distinct owner's derive version. Never throws. */
export async function bump_owner_versions(
  owner_ids: Array<string | null | undefined>
): Promise<void> {
  const owners = [...new Set(owner_ids.filter((o): o is string => !!o))];
  await Promise.all(owners.map((o) => bump_derive_version(o).catch(() => undefined)));
}
