/**
 * Deploy wiring for Feedback-And-Questions: a callable deploys only if it's re-exported up to
 * `src/index.ts`. Checked statically (importing the entry would initialise all of Firebase).
 */
import * as fs from "fs";
import * as path from "path";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("feedback callables are exported for deploy", () => {
  const callableIndex = read("../index.ts");

  it.each([
    ["submit_feedback", "./submit_feedback.entry"],
    ["list_my_feedback", "./list_my_feedback.entry"],
    ["get_feedback_status", "./get_feedback_status.entry"],
    ["manage_feedback_inbox", "./manage_feedback_inbox.entry"],
  ])("%s is exported from entry/callable/index.ts and defined in its file", (name, file) => {
    const exported = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"${file.replace(".", "\\.")}"`);
    const star = new RegExp(`export\\s*\\*\\s*from\\s*"${file.replace(".", "\\.")}"`);
    expect(exported.test(callableIndex) || star.test(callableIndex)).toBe(true);
    expect(read(`../${file.slice(2)}.ts`)).toMatch(new RegExp(`export const ${name}\\s*=\\s*onCall\\(`));
  });

  it("entry/callable is re-exported by entry/index.ts, which src/index.ts re-exports", () => {
    expect(read("../../index.ts")).toMatch(/export \* from "\.\/callable"/);
    expect(read("../../../../index.ts")).toMatch(/export \* from "\.\/functions\/entry"/);
  });
});
