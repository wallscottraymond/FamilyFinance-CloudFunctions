/**
 * Generated names never use animals associated with racist slurs (primates and similar), and
 * swapping one out kept the list the same length so existing names don't shift.
 */
import { ANIMALS, generated_name } from "../names.service";

const BLOCKED = [
  "ape", "monkey", "chimp", "gorilla", "baboon", "orangutan", "gibbon", "lemur", "macaque",
  "mandrill", "marmoset", "tamarin", "primate", "simian", "bonobo", "coon", "raccoon",
];

it("has no blocked animals", () => {
  const hits = ANIMALS.filter((a) => BLOCKED.some((b) => a.toLowerCase().includes(b)));
  expect(hits).toEqual([]);
});

it("keeps 64 animals so existing names stay put", () => {
  expect(ANIMALS).toHaveLength(64);
  expect(new Set(ANIMALS).size).toBe(64);
});

it("no generated name contains a blocked word", () => {
  for (let i = 0; i < 5000; i++) {
    const name = generated_name(`uid-${i}`).toLowerCase();
    expect(BLOCKED.some((b) => name.includes(b))).toBe(false);
  }
});
