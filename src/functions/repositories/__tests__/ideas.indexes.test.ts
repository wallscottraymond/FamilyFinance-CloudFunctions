/**
 * Ideas queries need composite indexes the emulator doesn't enforce — without this test a
 * dropped / reordered index would pass every emulator test and fail only in production.
 * Keep in step with `idea_repo.count_open` / `delete_comments` and the app's listeners
 * (ideas: userId ==, status ==, createdAt desc; idea_comments: ideaId ==, userId ==, createdAt).
 */
import * as fs from "fs";
import * as path from "path";

interface IndexField { fieldPath: string; order?: string; arrayConfig?: string }
interface Index { collectionGroup: string; queryScope: string; fields: IndexField[] }
interface FieldOverride { collectionGroup: string; fieldPath: string; ttl?: boolean }

const file = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../firestore.indexes.json"), "utf8"));
const indexes: Index[] = file.indexes;
const overrides: FieldOverride[] = file.fieldOverrides ?? [];

const has = (group: string, fields: IndexField[]): boolean =>
  indexes.some(
    (i) =>
      i.collectionGroup === group &&
      i.queryScope === "COLLECTION" &&
      JSON.stringify(i.fields) === JSON.stringify(fields)
  );

describe("ideas indexes", () => {
  it("ideas: userId + status + createdAt desc (the list listener + open count)", () => {
    expect(
      has("ideas", [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("idea_comments: ideaId + userId + createdAt (the comments listener)", () => {
    expect(
      has("idea_comments", [
        { fieldPath: "ideaId", order: "ASCENDING" },
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ])
    ).toBe(true);
  });

  it.each(["ideas", "idea_comments"])("converted ideas and their comments expire (TTL on %s.expireAt)", (group) => {
    expect(overrides.some((o) => o.collectionGroup === group && o.fieldPath === "expireAt" && o.ttl === true)).toBe(true);
  });
});
