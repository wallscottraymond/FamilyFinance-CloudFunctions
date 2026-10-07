/**
 * Generated names never use animals associated with racist slurs (primates and similar), and
 * the lists stay 200 × 200 so existing names don't shift.
 */
import { ADJECTIVES, ANIMALS, generated_name } from "../names.service";

const BLOCKED = [
  "ape", "monkey", "chimp", "gorilla", "baboon", "orangutan", "gibbon", "lemur", "macaque",
  "mandrill", "marmoset", "tamarin", "tarsier", "primate", "simian", "bonobo", "coon",
  "raccoon", "crow", "pig", "rat", "rodent", "jackal", "hyena", "weasel", "sloth",
];
/** Colors read as skin tone next to an animal; put-downs read as insults. */
const BLOCKED_ADJ = [
  "black", "white", "brown", "yellow", "red", "tan", "dark", "pale", "olive", "amber",
  "lazy", "dumb", "fat", "savage", "wild", "dirty", "stupid", "ugly",
];

it("has no blocked animals", () => {
  const hits = ANIMALS.filter((a) => BLOCKED.some((b) => a.toLowerCase().includes(b)));
  expect(hits).toEqual([]);
});

it("has no blocked adjectives", () => {
  const hits = ADJECTIVES.filter((a) => BLOCKED_ADJ.includes(a.toLowerCase()));
  expect(hits).toEqual([]);
});

it("keeps 200 × 200 unique words so names stay put", () => {
  expect(ADJECTIVES).toHaveLength(200);
  expect(ANIMALS).toHaveLength(200);
  expect(new Set(ADJECTIVES).size).toBe(200);
  expect(new Set(ANIMALS).size).toBe(200);
  expect(ADJECTIVES.filter((a) => ANIMALS.includes(a))).toEqual([]);
});

it("no generated name contains a blocked word", () => {
  for (let i = 0; i < 5000; i++) {
    const [adjective, animal] = generated_name(`uid-${i}`).toLowerCase().split(" ");
    expect(BLOCKED.some((b) => animal.includes(b))).toBe(false);
    expect(BLOCKED_ADJ.includes(adjective)).toBe(false);
  }
});
