/**
 * Round 4 test 5: the re-snap CLI's `--user` with no value refuses (never "all users").
 * Pure argument parsing + one spawn of the script that must exit BEFORE any Firestore use (run with
 * an unreachable emulator host and no credentials, so even a regression can't reach prod).
 */
import { spawnSync } from "child_process";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parse_resnap_args } = require("../../../scripts/resnap-args");

describe("resnap CLI arguments (round 4 test 5)", () => {
  it("parses the dry run, --write and --user <uid>", () => {
    expect(parse_resnap_args([])).toEqual({ write: false, user: undefined });
    expect(parse_resnap_args(["--write"])).toEqual({ write: true, user: undefined });
    expect(parse_resnap_args(["--user", "abc", "--write"])).toEqual({ write: true, user: "abc" });
    expect(parse_resnap_args(["--user=abc"])).toEqual({ write: false, user: "abc" });
  });

  it("--user with no value (end, another flag, empty) → refuses", () => {
    for (const argv of [["--user"], ["--user", "--write"], ["--write", "--user"], ["--user="], ["--user", ""]]) {
      expect(() => parse_resnap_args(argv)).toThrow(/needs a user id/);
    }
    expect(() => parse_resnap_args(["--usr", "x"])).toThrow(/unknown argument/);
  });

  it("the script itself exits non-zero on a bare --user, before touching Firestore", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:1", GCLOUD_PROJECT: "demo-none" };
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    const r = spawnSync(process.execPath, [path.join(__dirname, "../../../scripts/resnap-period-suppression.js"), "--user", "--write"], {
      env, encoding: "utf8", timeout: 20000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to run for all users/);
    expect(r.stdout).not.toMatch(/Scope:/);
  });
});
