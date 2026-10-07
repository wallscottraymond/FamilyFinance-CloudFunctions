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

const ADJECTIVES = [
  "Brave", "Calm", "Quiet", "Swift", "Bright", "Gentle", "Clever", "Happy",
  "Lucky", "Merry", "Noble", "Proud", "Sunny", "Witty", "Bold", "Cosy",
  "Daring", "Eager", "Fancy", "Fuzzy", "Golden", "Grand", "Jolly", "Kind",
  "Lively", "Mellow", "Misty", "Nimble", "Patient", "Plucky", "Polite", "Rapid",
  "Rosy", "Silver", "Sleepy", "Snappy", "Spry", "Steady", "Sturdy", "Tidy",
  "Velvet", "Warm", "Wise", "Zesty", "Breezy", "Cheery", "Crisp", "Dapper",
  "Frosty", "Hardy", "Humble", "Keen", "Lofty", "Mighty", "Peppy", "Quick",
  "Royal", "Scrappy", "Shy", "Smart", "Snowy", "Spicy", "Stormy", "Tender",
];

/**
 * No primates (apes, monkeys, chimps, gorillas, lemurs, ...): they're used as racist slurs.
 * Swap a word IN PLACE (same index) so nobody else's name changes; names_blocklist.test guards it.
 */
export const ANIMALS = [
  "Otter", "Panda", "Heron", "Robin", "Fox", "Badger", "Koala", "Lynx",
  "Owl", "Seal", "Wren", "Bison", "Crane", "Dolphin", "Falcon", "Gecko",
  "Hare", "Ibis", "Jaguar", "Kiwi", "Lark", "Moose", "Newt", "Ocelot",
  "Puffin", "Quail", "Raven", "Sparrow", "Tiger", "Walrus", "Yak", "Zebra",
  "Alpaca", "Beaver", "Camel", "Deer", "Eagle", "Ferret", "Goose", "Hedgehog",
  "Iguana", "Jackal", "Kestrel", "Llama", "Marten", "Narwhal", "Orca", "Pelican",
  "Rabbit", "Salmon", "Toucan", "Urchin", "Vole", "Weasel", "Finch", "Gazelle",
  "Hippo", "Impala", "Mole", "Penguin", "Squirrel", "Turtle", "Viper", "Wombat",
];

/** Longest nickname a user can set. */
export const MAX_NICKNAME_LENGTH = 40;

/** FNV-1a 32-bit hash: stable across runtimes, good enough to spread uids. */
function hash_uid(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The generated "Adjective Animal" name for a uid. Same uid → same name. */
export function generated_name(uid: string): string {
  const h = hash_uid(uid);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length];
  return `${adjective} ${animal}`;
}

/**
 * Normalizes a nickname: trimmed, inner whitespace collapsed. Empty → null
 * (clears it). Returns an error for names that are too long.
 */
export function normalize_nickname(
  raw: string
): { nickname: string | null; error?: string } {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (nickname.length === 0) return { nickname: null };
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    return { nickname: null, error: `Names can be up to ${MAX_NICKNAME_LENGTH} characters` };
  }
  return { nickname };
}

/** How `user_id` appears to a viewer, given the viewer's nicknames. */
export function person_view(
  user_id: string,
  viewer_nicknames: Record<string, string>
): PersonView {
  return {
    user_id,
    generated_name: generated_name(user_id),
    nickname: viewer_nicknames[user_id] ?? null,
  };
}
