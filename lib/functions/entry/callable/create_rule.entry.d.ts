/**
 * create_rule — onCall entry to create a Rule Book rule.
 *
 * Auth → Zod shape validation → semantic validation (≥1 condition, ≥1 action) → per-user cap →
 * persist. Priority defaults to the bottom of the list.
 *
 * @module entry/callable/create_rule
 */
import { CreateRuleResponse } from "../../types/rules_crud.types";
export declare const create_rule: import("firebase-functions/v2/https").CallableFunction<any, Promise<CreateRuleResponse>, unknown>;
//# sourceMappingURL=create_rule.entry.d.ts.map