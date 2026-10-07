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
export const ADJECTIVES = [
  "Able", "Agile", "Airy", "Artful", "Balmy", "Bold", "Bouncy", "Brave", "Breezy", "Bright",
  "Brisk", "Bubbly", "Busy", "Calm", "Candid", "Capable", "Careful", "Caring", "Charming",
  "Cheery", "Chipper", "Classy", "Clever", "Cosmic", "Cozy", "Crafty", "Crisp", "Cuddly",
  "Curious", "Dainty", "Dandy", "Dapper", "Daring", "Dashing", "Dazzling", "Deft", "Devoted",
  "Dreamy", "Dynamic", "Eager", "Easy", "Elegant", "Epic", "Fabled", "Fair", "Faithful", "Fancy",
  "Fearless", "Festive", "Fiery", "Fine", "Fleet", "Fluffy", "Focused", "Frank", "Free", "Fresh",
  "Friendly", "Frosty", "Fuzzy", "Gallant", "Generous", "Gentle", "Giddy", "Gifted", "Glad",
  "Gleaming", "Glowing", "Golden", "Graceful", "Gracious", "Grand", "Grateful", "Great", "Handy",
  "Happy", "Hardy", "Hearty", "Helpful", "Heroic", "Honest", "Hopeful", "Humble", "Ideal",
  "Inventive", "Jaunty", "Jazzy", "Jolly", "Jovial", "Joyful", "Jumpy", "Keen", "Kind", "Likable",
  "Lively", "Lofty", "Loyal", "Lucky", "Lunar", "Magic", "Majestic", "Mellow", "Merry", "Mighty",
  "Mindful", "Misty", "Modest", "Musical", "Mystic", "Natty", "Nautical", "Neat", "Nifty",
  "Nimble", "Noble", "Patient", "Peaceful", "Peppy", "Perky", "Placid", "Playful", "Plucky",
  "Plush", "Poised", "Polished", "Polite", "Prime", "Proud", "Pure", "Quick", "Quiet", "Quirky",
  "Radiant", "Rapid", "Ready", "Regal", "Rising", "Roaming", "Robust", "Royal", "Rugged",
  "Rustic", "Savvy", "Scenic", "Serene", "Sharp", "Shiny", "Silky", "Silver", "Sincere", "Sleek",
  "Smart", "Smooth", "Snappy", "Snowy", "Snug", "Social", "Solar", "Solid", "Sparkly", "Speedy",
  "Spicy", "Spirited", "Spry", "Stable", "Starry", "Steady", "Stellar", "Sterling", "Stormy",
  "Sturdy", "Sublime", "Sunny", "Super", "Sweet", "Tender", "Thoughtful", "Thrifty", "Tidy",
  "Tireless", "Tranquil", "True", "Trusty", "Twinkly", "Unique", "Upbeat", "Valiant", "Velvet",
  "Vibrant", "Vivid", "Warm", "Whimsical", "Wise", "Witty", "Wondrous", "Worthy", "Zany", "Zen",
  "Zesty", "Zippy",
];

/**
 * 200 × 200 = 40,000 names. No primates (apes, monkeys, chimps, gorillas, lemurs, ...) or
 * other animals used as slurs/put-downs. Swap a word IN PLACE (same index) so nobody else's name
 * changes; names_blocklist.test guards both lists.
 */
export const ANIMALS = [
  "Aardvark", "Albatross", "Alligator", "Alpaca", "Angelfish", "Anteater", "Antelope",
  "Armadillo", "Axolotl", "Badger", "Barracuda", "Bear", "Beaver", "Bee", "Beetle", "Beluga",
  "Bison", "Bobcat", "Buffalo", "Bumblebee", "Bunny", "Butterfly", "Camel", "Canary", "Capybara",
  "Caracal", "Cardinal", "Caribou", "Cassowary", "Chameleon", "Cheetah", "Chickadee",
  "Chinchilla", "Chipmunk", "Cicada", "Clownfish", "Coati", "Cockatoo", "Condor", "Cougar",
  "Coyote", "Crab", "Crane", "Cricket", "Crocodile", "Curlew", "Dingo", "Dolphin", "Dove",
  "Dragonfly", "Duck", "Dugong", "Eagle", "Egret", "Eland", "Elephant", "Elk", "Emu", "Ermine",
  "Falcon", "Fawn", "Fennec", "Ferret", "Finch", "Firefly", "Flamingo", "Fox", "Frog", "Gazelle",
  "Gecko", "Giraffe", "Goldfinch", "Goldfish", "Goose", "Gopher", "Grizzly", "Hamster", "Hare",
  "Harrier", "Hawk", "Hedgehog", "Heron", "Hippo", "Hornbill", "Hummingbird", "Ibex", "Ibis",
  "Iguana", "Impala", "Jackrabbit", "Jaguar", "Jay", "Jellyfish", "Kangaroo", "Kestrel",
  "Kingfisher", "Kinkajou", "Kiwi", "Koala", "Koi", "Kookaburra", "Kudu", "Ladybug", "Lark",
  "Leopard", "Lion", "Llama", "Lobster", "Lynx", "Macaw", "Magpie", "Mallard", "Manatee",
  "Mantis", "Marlin", "Marmot", "Marten", "Meerkat", "Merlin", "Mongoose", "Moose", "Mustang",
  "Narwhal", "Newt", "Nightingale", "Ocelot", "Octopus", "Okapi", "Oriole", "Orca", "Oryx",
  "Osprey", "Ostrich", "Otter", "Owl", "Panda", "Panther", "Parrot", "Partridge", "Peacock",
  "Pelican", "Penguin", "Petrel", "Pheasant", "Pika", "Platypus", "Plover", "Pony", "Porcupine",
  "Porpoise", "Puffin", "Puma", "Quail", "Quetzal", "Quokka", "Rabbit", "Raven", "Reindeer",
  "Rhino", "Roadrunner", "Robin", "Salamander", "Salmon", "Sandpiper", "Seahorse", "Seal",
  "Serval", "Shark", "Skylark", "Sparrow", "Squid", "Squirrel", "Starfish", "Starling",
  "Stingray", "Stork", "Swallow", "Swan", "Tapir", "Tern", "Thrush", "Tiger", "Tortoise",
  "Toucan", "Trout", "Turtle", "Urchin", "Vole", "Wallaby", "Walrus", "Warbler", "Whale",
  "Wildcat", "Wolf", "Wolverine", "Wombat", "Woodpecker", "Wren", "Yak", "Zebra",
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
