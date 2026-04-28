import { TransferGroupOwnershipRequest, TransferGroupOwnershipResponse } from "../../../../types";
/**
 * Transfer group ownership to another member
 *
 * Only the current owner can transfer ownership.
 * The new owner must be an existing member of the group.
 * The previous owner is demoted to admin.
 */
export declare const transferGroupOwnership: import("firebase-functions/v2/https").CallableFunction<TransferGroupOwnershipRequest, Promise<TransferGroupOwnershipResponse>, unknown>;
//# sourceMappingURL=transferGroupOwnership.d.ts.map