/** generated_display_name — deterministic, friendly, well spread. */
import { generated_display_name } from "../generated_name.service";

it("is deterministic per uid", () => {
  expect(generated_display_name("VrXZSGuPvyaTw8kuXVrzZZYcEQe2")).toBe(generated_display_name("VrXZSGuPvyaTw8kuXVrzZZYcEQe2"));
});

it("looks like 'Adjective Animal'", () => {
  for (const uid of ["a", "abc", "VrXZSGuPvyaTw8kuXVrzZZYcEQe2", "x".repeat(28)]) {
    expect(generated_display_name(uid)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  }
});

it("spreads across many names (1,000 random uids → mostly distinct)", () => {
  const names = new Set<string>();
  for (let i = 0; i < 1000; i++) names.add(generated_display_name(`uid_${i}_${(i * 2654435761) % 1e9}`));
  expect(names.size).toBeGreaterThan(550); // 1,024 possible pairs
});
