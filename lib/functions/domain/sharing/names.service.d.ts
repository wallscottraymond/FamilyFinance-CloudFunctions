/**
 * Generated Names (D28)
 *
 * Budg never shows a real name or email to another person. Everyone gets an
 * "Adjective Animal" name computed from their uid (stable, nothing stored), and
 * each viewer can give a connection a private nickname.
 *
 * PURE: no IO.
 *
 * @module domain/sharing/names
 */
import { PersonView } from "../../types/sharing.types";
/** No colors (skin-tone readings) or put-downs. */
export declare const ADJECTIVES: string[];
/**
 * 200 × 200 = 40,000 names. No primates (apes, monkeys, chimps, gorillas, lemurs, ...) or
 * other animals used as slurs/put-downs. Swap a word IN PLACE (same index) so nobody else's name
 * changes; names_blocklist.test guards both lists.
 */
export declare const ANIMALS: string[];
/** Longest nickname a user can set. */
export declare const MAX_NICKNAME_LENGTH = 40;
/** The generated "Adjective Animal" name for a uid. Same uid → same name. */
export declare function generated_name(uid: string): string;
/**
 * Normalizes a nickname: trimmed, inner whitespace collapsed. Empty → null
 * (clears it). Returns an error for names that are too long.
 */
export declare function normalize_nickname(raw: string): {
    nickname: string | null;
    error?: string;
};
/** How `user_id` appears to a viewer, given the viewer's nicknames. */
export declare function person_view(user_id: string, viewer_nicknames: Record<string, string>): PersonView;
//# sourceMappingURL=names.service.d.ts.map