/** is_anonymous_sign_in (create_link_token guard) ("Try it without an account") callers (Sign-In-With-Apple). */
import { is_anonymous_sign_in } from "../sign_in_provider.service";

it("anonymous provider, no linked identity → blocked", () => {
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "anonymous" } })).toBe(true);
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "anonymous", identities: {} } })).toBe(true);
});
it("anonymous session secured with Apple / email (same uid) → allowed", () => {
  expect(
    is_anonymous_sign_in({ firebase: { sign_in_provider: "anonymous", identities: { "apple.com": ["001.abc"] } } })
  ).toBe(false);
  expect(
    is_anonymous_sign_in({ firebase: { sign_in_provider: "anonymous", identities: { email: ["a@b.co"] } } })
  ).toBe(false);
});
it("apple / password / missing → allowed", () => {
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "apple.com" } })).toBe(false);
  expect(is_anonymous_sign_in({ firebase: { sign_in_provider: "password" } })).toBe(false);
  expect(is_anonymous_sign_in(undefined)).toBe(false);
});
