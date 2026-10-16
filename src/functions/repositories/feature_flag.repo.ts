/**
 * Feature Flag Repository — READ-ONLY boundary over `_feature_flags` for resolvers (which may only
 * read through repositories). Delegates to the per-instance cached flag loader in
 * `infrastructure/feature_flags` (one collection read per instance per TTL, shared with every
 * other flag check on that instance).
 *
 * @module repositories/feature_flag
 */
import { is_convert_to_recurring_enabled } from "../infrastructure/feature_flags";

export const feature_flag_repo = {
  /** Convert-To-Recurring capture-rules flag for this user (cached; never throws; problem = off). */
  async is_convert_to_recurring_enabled(user_id: string): Promise<boolean> {
    try {
      return await is_convert_to_recurring_enabled(user_id);
    } catch {
      return false;
    }
  },
};
