/** is_anonymous_sign_in (create_link_token guard) ("Try it without an account") callers (Sign-In-With-Apple). */
import { is_anonymous_sign_in } from "../sign_in_provider.service";

it("anonymous provider → blocked", () => {
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "anonymous" } })).toBe(true);
});
it("apple / password / missing → allowed", () => {
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "apple.com" } })).toBe(false);
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "password" } })).toBe(false);
  expect(is_anonymous_sign_in(undefined)).toBe(false);
});
