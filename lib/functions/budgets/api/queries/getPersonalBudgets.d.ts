import { Budget } from "../../../../types";
/**
 * Get personal budgets for individual users (not family-based)
 * This function works for users regardless of family membership.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable) — the client
 * no longer hand-builds URLs or attaches tokens. Returns the Budget[] directly.
 */
export declare const getPersonalBudgets: import("firebase-functions/v2/https").CallableFunction<any, Promise<Budget[]>, unknown>;
//# sourceMappingURL=getPersonalBudgets.d.ts.map