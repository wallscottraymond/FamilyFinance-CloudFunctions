/**
 * Deploy wiring for Ideas (Planning-Module v1): a callable deploys only if it's re-exported up to
 * `src/index.ts`. Checked statically (importing the entry would initialise all of Firebase).
 */
import * as fs from "fs";
import * as path from "path";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("ideas callables are exported for deploy", () => {
  const callableIndex = read("../index.ts");

  it.each([
    ["create_idea", "./create_idea.entry"],
    ["update_idea", "./update_idea.entry"],
    ["delete_idea", "./delete_idea.entry"],
    ["react_to_idea", "./react_to_idea.entry"],
    ["get_ideas_capabilities", "./get_ideas_capabilities.entry"],
  ])("%s is exported from entry/callable/index.ts and defined in its file", (name, file) => {
    const exported = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"${file.replace(".", "\\.")}"`);
    expect(exported.test(callableIndex)).toBe(true);
    expect(read(`../${file.slice(2)}.ts`)).toMatch(new RegExp(`export const ${name}\\s*=\\s*onCall\\(`));
  });

  it("entry/callable is re-exported by entry/index.ts, which src/index.ts re-exports", () => {
    expect(read("../../index.ts")).toMatch(/export \* from "\.\/callable"/);
    expect(read("../../../../index.ts")).toMatch(/export \* from "\.\/functions\/entry"/);
  });
});
