/**
 * O1 guard + the re-assign engine's scoped single-flight key. Pure.
 */

jest.mock("../../../repositories/user.repo", () => ({ user_repo: { get_all_ids: jest.fn() } }));
jest.mock("../../../infrastructure/job_queue", () => ({
  build_dedup_key: jest.fn(),
  create_job: jest.fn(),
  create_job_if_not_exists: jest.fn(),
}));

import { category_mapping_changed } from "../on_category_written.trigger";
import { reassign_dedup_key } from "../../../orchestrators/transactions/reassign_user.orchestrator";

describe("category_mapping_changed (canon O1)", () => {
  const doc = { firstCategoryId: "shopping", overallCategoryId: "shopping", isActive: true, first_category: "Shopping" };

  it("a code moved to another first re-assigns", () => {
    expect(category_mapping_changed(doc, { ...doc, firstCategoryId: "hobbies" })).toBe(true);
  });
  it("add / remove / (de)activate / merchant-rule edits re-assign", () => {
    expect(category_mapping_changed(null, doc)).toBe(true);
    expect(category_mapping_changed(doc, null)).toBe(true);
    expect(category_mapping_changed(doc, { ...doc, isActive: false })).toBe(true);
    expect(category_mapping_changed(doc, { ...doc, merchants: ["mous"] })).toBe(true);
  });
  it("a display-name rename does not (C5: renames are display-only)", () => {
    expect(category_mapping_changed(doc, { ...doc, first_category: "Shopping & Gifts" })).toBe(false);
  });
});

describe("reassign_dedup_key", () => {
  it("unscoped = one per user; a scoped run gets its own key (not swallowed)", () => {
    expect(reassign_dedup_key("u")).toBe("reassign_user:u");
    expect(reassign_dedup_key("u", { account_ids: ["b", "a"] })).toBe("reassign_user:u:a,b||");
    expect(reassign_dedup_key("u", { account_ids: ["a", "b"] })).toBe(reassign_dedup_key("u", { account_ids: ["b", "a"] }));
  });
});
