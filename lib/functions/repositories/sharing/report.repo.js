"use strict";
/**
 * Report Repository (D27)
 *
 * `reports/{id}`: someone reported another person. Functions-only; reviewed by
 * hand. Never readable by clients.
 *
 * @module repositories/sharing/report
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.report_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "reports";
exports.report_repo = {
    new_id() {
        return (0, firestore_1.getFirestore)().collection(COLLECTION).doc().id;
    },
    async save(_ctx, entity) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await (0, firestore_1.getFirestore)().collection(COLLECTION).doc(entity.id).set({
            reporterId: entity.reporter_id,
            reportedId: entity.reported_id,
            reason: entity.reason,
            createdAt: firestore_1.Timestamp.fromMillis(entity.created_at_ms),
            status: "open",
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
};
//# sourceMappingURL=report.repo.js.map