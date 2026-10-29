/**
 * Convert-To-Recurring Phase 1 deploy checks (extras: N8 + the listener index). READ-ONLY.
 *   - N8: every function of the X21 deploy set is reachable from src/index.ts through explicit
 *     exports, and every derive function + widget_snapshot is in that one set
 *     (scripts/check-convert-deploy-set.js — also runnable from the CLI before a deploy);
 *   - the checker really detects a missing export (a synthetic tree);
 *   - the FE listener's composite index (recurring_review_items: userId + status) and the account
 *     removal query's (userId + accountId + status) are in firestore.indexes.json (the rules side
 *     of the listener query is covered by reviewItemsRules.emulator.test.ts).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const checker = require(path.join(ROOT, "scripts", "check-convert-deploy-set.js"));

describe("N8 deploy set", () => {
  it("every deploy-set function is exported; all derive functions + widget_snapshot are in the one set", () => {
    const r = checker.check_deploy_set(ROOT);
    expect(r.missing).toEqual([]);
    expect(r.derive_not_in_set).toEqual([]);
    expect(r.ok).toBe(true);
    for (const f of ["derive_period", "derive_period_range", "derive_budget_view", "derive_recurring_view", "widget_snapshot"]) {
      expect(checker.DEPLOY_SET).toContain(f);
    }
    expect(r.command).toContain("deploy ALL functions");
    for (const f of ["convert_transaction_to_recurring", "preview_convert_transaction", "get_recurring_capabilities", "assign_split_to_inflow", "undo_recurring_merge"]) {
      expect(checker.DEPLOY_SET).toContain(f);
    }
  });

  it("the checker catches an export that only a barrel it isn't in would provide", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n8-"));
    fs.mkdirSync(path.join(dir, "src", "functions", "entry"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "export * from \"./functions/entry\";\n");
    fs.writeFileSync(path.join(dir, "src", "functions", "entry", "index.ts"),
      "export { derive_period } from \"./a\";\n// export { process_job_queue } from \"./b\";\n");
    const r = checker.check_deploy_set(dir);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("process_job_queue"); // a commented-out export doesn't count
    expect(r.missing).not.toContain("derive_period");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("review items: listener indexes", () => {
  const indexes = JSON.parse(fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")).indexes as Array<{
    collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string }>;
  }>;
  const has = (fields: string[]) => indexes.some((i) =>
    i.collectionGroup === "recurring_review_items" && i.queryScope === "COLLECTION" &&
    JSON.stringify(i.fields.map((f) => f.fieldPath)) === JSON.stringify(fields));
  it("userId + status (the app's one listener) and userId + accountId + status (account removal)", () => {
    expect(has(["userId", "status"])).toBe(true);
    expect(has(["userId", "accountId", "status"])).toBe(true);
  });
});
