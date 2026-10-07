/**
 * Report Repository (D27)
 *
 * `reports/{id}`: someone reported another person. Functions-only; reviewed by
 * hand. Never readable by clients.
 *
 * @module repositories/sharing/report
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { PersonReport } from "../../types/sharing.types";

const COLLECTION = "reports";

export const report_repo = {
  new_id(): string {
    return getFirestore().collection(COLLECTION).doc().id;
  },

  async save(_ctx: TraceContext, entity: PersonReport): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await getFirestore().collection(COLLECTION).doc(entity.id).set({
      reporterId: entity.reporter_id,
      reportedId: entity.reported_id,
      reason: entity.reason,
      createdAt: Timestamp.fromMillis(entity.created_at_ms),
      status: "open",
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },
};
