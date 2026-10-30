/**
 * Deploy surface guard (Code-Health-Review P2-M2 / A2-M3 / M1-M3).
 *
 * dev == prod: anything exported up the index chain is deployed to the one live project.
 * Dev seeders (createTestTransactions, createTestTransactionsByCategory, createTestBudgetSuite)
 * were exported and callable by any signed-in user, writing fake accounts / budgets /
 * transactions into real data. This test fails if a dev-only module or a seeder-style function
 * can reach the deploy entry again.
 */
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "..");

function source_files(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      source_files(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Source with comments removed, so commented-out exports don't count. */
function code_only(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FILES = source_files(SRC);
const rel = (f: string) => path.relative(SRC, f);

describe("deploy surface", () => {
  it("scans a real source tree", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.map(rel)).toContain("index.ts");
  });

  it("no module re-exports from a dev/ folder", () => {
    const offenders = FILES.filter((f) =>
      /export\s[^;]*from\s+["'][^"']*\/dev(\/[^"']*)?["']/.test(code_only(fs.readFileSync(f, "utf8")))
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no exported function is a seeder (createTest*, seed*, simulate*)", () => {
    const pattern = /export\s+(?:const|function|async\s+function)\s+(createTest\w*|seed\w*|simulate\w*)\b/g;
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of code_only(fs.readFileSync(f, "utf8")).matchAll(pattern)) {
        offenders.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the retired seeders are gone from the tree", () => {
    for (const name of ["createTestTransactions", "createTestTransactionsByCategory", "createTestBudgetSuite"]) {
      const hits = FILES.filter((f) => code_only(fs.readFileSync(f, "utf8")).includes(name)).map(rel);
      expect({ name, hits }).toEqual({ name, hits: [] });
    }
  });
});
