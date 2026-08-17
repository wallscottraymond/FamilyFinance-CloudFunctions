/**
 * Trigger Safety — guardrail unit test
 *
 * Prevents the cost footgun that caused ~921K/day of wasted invocations
 * (2026-08-15): `onGroupMembershipUpdate` was registered on the wildcard path
 * `{collection}/{groupId}`, which matches EVERY top-level collection, so the
 * function fired on every transaction/period/job write.
 *
 * This test scans every Firestore trigger registration in the source and fails
 * if any uses a WILDCARD collection segment (first path segment is `{...}`).
 * A Firestore trigger must always name a literal collection.
 */
import * as fs from "fs";
import * as path from "path";

const FUNCTIONS_DIR = path.resolve(__dirname, "..");

/** Recursively collect .ts source files (skip tests, type decls). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** All `document: "<path>"` trigger patterns found in source, with their file. */
function findTriggerDocumentPaths(): Array<{ file: string; pattern: string }> {
  const files = collectTsFiles(FUNCTIONS_DIR);
  const re = /document:\s*["'`]([^"'`]+)["'`]/g;
  const found: Array<{ file: string; pattern: string }> = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      found.push({ file: path.relative(FUNCTIONS_DIR, file), pattern: m[1] });
    }
  }
  return found;
}

const isWildcardSegment = (seg: string): boolean => /^\{.*\}$/.test(seg);

describe("Firestore trigger safety", () => {
  const triggers = findTriggerDocumentPaths();

  it("finds trigger document patterns (sanity — regex still works)", () => {
    expect(triggers.length).toBeGreaterThan(5);
  });

  it("NEVER registers a trigger on a wildcard collection segment", () => {
    // A violation fires on EVERY collection's writes (the ~921K/day cost bug).
    // On failure, the diff below names the offending file(s) + pattern(s); scope
    // each to a literal collection (e.g. 'groups/{groupId}', not '{c}/{id}').
    const violations = triggers
      .filter(({ pattern }) => isWildcardSegment(pattern.split("/")[0]))
      .map((v) => `${v.file}: document: '${v.pattern}'`);
    expect(violations).toEqual([]);
  });

  it("keeps the group-membership trigger scoped to groups/{groupId}", () => {
    // Regression lock for the 2026-08-17 fix.
    const groupTriggerFile = "sharing/orchestration/triggers/onGroupMembershipUpdate.ts";
    const patternsInFile = triggers
      .filter((t) => t.file === groupTriggerFile)
      .map((t) => t.pattern);
    expect(patternsInFile).toContain("groups/{groupId}");
    // And it must NOT reintroduce a catch-all or a families path (groups-only).
    expect(patternsInFile.some((p) => isWildcardSegment(p.split("/")[0]))).toBe(false);
    expect(patternsInFile.some((p) => p.startsWith("families/"))).toBe(false);
  });
});
