/**
 * Generated display names for accounts that share no name ([[Sign-In-With-Apple]]): Sign in with
 * Apple requests NO scopes (no name, no email) and anonymous accounts have none, so the app never
 * holds a real name. Friendly "Adjective Animal" (e.g. "Calm Otter"), DETERMINISTIC from the uid —
 * the same account always gets the same name (a re-run trigger can't rename it). Editable later.
 *
 * PURE: no IO.
 *
 * @module domain/users/generated_name
 */

const ADJECTIVES = [
  "Calm", "Bright", "Brave", "Clever", "Cozy", "Eager", "Gentle", "Happy",
  "Jolly", "Kind", "Lively", "Lucky", "Merry", "Mighty", "Nimble", "Noble",
  "Patient", "Plucky", "Quick", "Quiet", "Sunny", "Steady", "Swift", "Thrifty",
  "Tidy", "Wise", "Witty", "Zesty", "Golden", "Hearty", "Keen", "Smart",
] as const;

const ANIMALS = [
  "Otter", "Finch", "Fox", "Badger", "Beaver", "Bison", "Crane", "Deer",
  "Dolphin", "Eagle", "Falcon", "Gecko", "Heron", "Koala", "Lark", "Lynx",
  "Marten", "Moose", "Owl", "Panda", "Penguin", "Puffin", "Rabbit", "Raven",
  "Robin", "Seal", "Sparrow", "Squirrel", "Swan", "Tiger", "Turtle", "Wren",
] as const;

/** 32-bit FNV-1a hash (stable across runtimes). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** "Adjective Animal" for a uid — same uid, same name. */
export function generated_display_name(uid: string): string {
  const h = fnv1a(uid);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length]}`;
}
