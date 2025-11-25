/**
 * Delete Checklist Item from Budget Period
 *
 * Cloud Function for removing checklist items from budget periods.
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
 * Delete a checklist item from a budget period
 */
export declare const deleteChecklistItem: import("firebase-functions/v2/https").CallableFunction<any, Promise<ChecklistItemResponse>>;
export {};
//# sourceMappingURL=deleteChecklistItem.d.ts.map