/**
 * Day counting (Code-Health-Review M1-M4 / M4-M5). Periods end at 23:59:59.999 UTC, so
 * `ceil((end − start) / day) + 1` counts one day too many (October = 32, a week = 8). Every period
 * day count uses the UTC-normalized `count_days_inclusive` (root CLAUDE.md rule); this suite
 * pins the helper and fails if the ceil formula comes back anywhere in the backend source.
 */
import * as fs from "fs";
import * as path from "path";
import { count_days_inclusive } from "../budgets/period_generation.service";

const SRC = path.resolve(__dirname, "../../..");

function source_files(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") source_files(p, out);
    } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("period day counts", () => {
  it("count whole UTC days for periods ending at 23:59:59.999", () => {
    expect(count_days_inclusive(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59.999Z"))).toBe(31);
    expect(count_days_inclusive(new Date("2026-10-04T00:00:00Z"), new Date("2026-10-10T23:59:59.999Z"))).toBe(7);
    expect(count_days_inclusive(new Date("2026-02-16T00:00:00Z"), new Date("2026-02-28T23:59:59.999Z"))).toBe(13);
  });

  it("no backend source counts days with ceil(diff / day) + 1", () => {
    const pattern = /Math\.ceil\([^;]*\/\s*\(?\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24\s*\)?\s*\)\s*\+\s*1/;
    const offenders = source_files(SRC).filter((f) => pattern.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
