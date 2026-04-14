/**
 * Resource Sharing Functions
 *
 * Functions for sharing resources (budgets, transactions, etc.) with users and groups.
 * Part of the RBAC v2 system using onCall pattern and groupIds[].
 */

// Share a resource with a user or group
export { shareResource } from './shareResource';

// Remove sharing from a resource
export { unshareResource } from './unshareResource';

// Update permissions for an existing share
export { updateSharePermissions } from './updateSharePermissions';

// Get all resources shared with the current user
export { getUserSharedResources } from './getUserSharedResources';

// Get all shares for a specific resource
export { getResourceShares } from './getResourceShares';
