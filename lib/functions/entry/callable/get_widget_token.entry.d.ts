/**
 * Get Widget Token Entry Point ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Signed-in callable: returns the account's read-only widget token (creating it on first
 * use). `rotate: true` revokes the old token and issues a new one ("Reset widget access").
 * The app stores it in the shared keychain for the widget extension's self-fetch.
 *
 * @module entry/callable/get_widget_token
 */
import { FunctionResponse } from "../../types";
export declare const get_widget_token: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<{
    token: string;
}>>, unknown>;
//# sourceMappingURL=get_widget_token.entry.d.ts.map