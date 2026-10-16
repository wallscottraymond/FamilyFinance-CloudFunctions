/**
 * Review round 3, defect 7 (hardening) / Top-25 #10 "override guard": the per-test-file flag
 * collection override is honored ONLY on the emulator. Without FIRESTORE_EMULATOR_HOST the flag
 * read always uses `_feature_flags`, and no checked-in / local `.env*` file sets the override (a
 * deployed function would load it).
 */
import * as fs from "fs";
import * as path from "path";
import { FEATURE_FLAGS_COLLECTION, feature_flags_collection } from "../feature_flags";

describe("feature flag collection override guard (defect 7)", () => {
  it("no emulator host → `_feature_flags`, whatever the override says", () => {
    expect(feature_flags_collection({ FEATURE_FLAGS_COLLECTION_OVERRIDE: "_feature_flags_evil" })).toBe("_feature_flags");
    expect(feature_flags_collection({})).toBe(FEATURE_FLAGS_COLLECTION);
    expect(FEATURE_FLAGS_COLLECTION).toBe("_feature_flags");
  });

  it("emulator host set → the override is honored (the emulator suites' isolation)", () => {
    expect(feature_flags_collection({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FEATURE_FLAGS_COLLECTION_OVERRIDE: "_feature_flags_t1",
    })).toBe("_feature_flags_t1");
    expect(feature_flags_collection({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toBe("_feature_flags");
    expect(feature_flags_collection({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FEATURE_FLAGS_COLLECTION_OVERRIDE: "" })).toBe("_feature_flags");
  });

  it("no .env* file in the functions root sets the override", () => {
    const root = path.resolve(__dirname, "../../../..");
    const env_files = fs.readdirSync(root).filter((f) => f.startsWith(".env"));
    expect(env_files.length).toBeGreaterThan(0); // the check actually looked somewhere
    for (const f of env_files) {
      const text = fs.readFileSync(path.join(root, f), "utf8");
      expect({ file: f, sets: /^\s*(export\s+)?FEATURE_FLAGS_COLLECTION_OVERRIDE\s*=/m.test(text) }).toEqual({ file: f, sets: false });
    }
  });
});
