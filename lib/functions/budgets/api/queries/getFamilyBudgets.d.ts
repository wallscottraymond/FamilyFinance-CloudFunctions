import { Budget } from "../../../../types";
/**
 * Get family budgets.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * Budget[] directly. Users without a family get a `failed-precondition` error whose
 * message contains "User must belong to a family" — the client detects this and
 * falls back to personal budgets.
 */
export declare const getFamilyBudgets: import("firebase-functions/v2/https").CallableFunction<any, Promise<Budget[]>, unknown>;
//# sourceMappingURL=getFamilyBudgets.d.ts.map