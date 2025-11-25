/**
 * Update Checklist Item in Budget Period
 *
 * Cloud Function for updating existing checklist items in budget periods.
 * Security: Only budget owners can modify their checklist items
 * Memory: 256MiB, Timeout: 30s
 */
import { ChecklistItem } from '../../../../types';
interface ChecklistItemResponse {
    success: boolean;
    checklistItem?: ChecklistItem;
    message?: string;
}
/**
 * Update an existing checklist item in a budget period
 */
export declare const updateChecklistItem: import("firebase-functions/v2/https").CallableFunction<any, Promise<ChecklistItemResponse>>;
export {};
//# sourceMappingURL=updateChecklistItem.d.ts.map