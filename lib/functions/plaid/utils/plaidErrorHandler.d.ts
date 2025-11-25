/**
 * Internal handler function that can be called directly from other cloud functions
 * Bypasses authentication since it's called from trusted code
 */
export declare function handlePlaidErrorInternal(itemId: string, userId: string, error: any, context?: string): Promise<{
    success: boolean;
    actionsPerformed: string[];
}>;
/**
 * Centralized Plaid error handler
 * Analyzes Plaid errors and takes appropriate actions like updating item status
 */
export declare const plaidErrorHandler: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    itemId: string;
    userId: string;
    actionsPerformed: string[];
    message: string;
}>>;
//# sourceMappingURL=plaidErrorHandler.d.ts.map