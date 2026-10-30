/**
 * Report Repository (D27)
 *
 * `reports/{id}`: someone reported another person. Functions-only; reviewed by
 * hand. Never readable by clients.
 *
 * @module repositories/sharing/report
 */
import { TraceContext } from "../../types";
import { PersonReport } from "../../types/sharing.types";
export declare const report_repo: {
    new_id(): string;
    save(_ctx: TraceContext, entity: PersonReport): Promise<void>;
};
//# sourceMappingURL=report.repo.d.ts.map