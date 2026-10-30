"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bump_owner_versions = bump_owner_versions;
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
/** Bumps each distinct owner's derive version. Never throws. */
async function bump_owner_versions(owner_ids) {
    const owners = [...new Set(owner_ids.filter((o) => !!o))];
    await Promise.all(owners.map((o) => (0, derive_version_repo_1.bump_derive_version)(o).catch(() => undefined)));
}
//# sourceMappingURL=versions.js.map