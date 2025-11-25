/**
 * Toggle Checklist Item Status in Budget Period
 *
 * Cloud Function for toggling the checked status of checklist items.
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
 * Toggle the checked status of a checklist item
 */
export declare const toggleChecklistItem: import("firebase-functions/v2/https").CallableFunction<any, Promise<ChecklistItemResponse>>;
export {};
//# sourceMappingURL=toggleChecklistItem.d.ts.map