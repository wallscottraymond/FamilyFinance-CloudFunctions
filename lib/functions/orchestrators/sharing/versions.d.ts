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
/** Bumps each distinct owner's derive version. Never throws. */
export declare function bump_owner_versions(owner_ids: Array<string | null | undefined>): Promise<void>;
//# sourceMappingURL=versions.d.ts.map