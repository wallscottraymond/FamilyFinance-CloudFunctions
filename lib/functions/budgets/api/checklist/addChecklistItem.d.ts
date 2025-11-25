/**
 * Add Checklist Item to Budget Period
 *
 * Cloud Function for adding new checklist items to budget periods.
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
 * Add a new checklist item to a budget period
 */
export declare const addChecklistItem: import("firebase-functions/v2/https").CallableFunction<any, Promise<ChecklistItemResponse>>;
export {};
//# sourceMappingURL=addChecklistItem.d.ts.map