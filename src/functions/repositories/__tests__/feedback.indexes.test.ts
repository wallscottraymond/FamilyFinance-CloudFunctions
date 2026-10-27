/**
 * The Feedback Inbox query needs composite indexes the emulator doesn't enforce — without this
 * test a dropped / reordered index would pass every emulator test and fail only in production.
 * Keep in step with `feedback_repo.list_inbox` (status ==, [type ==], createdAt desc, __name__ desc).
 */
import * as fs from "fs";
import * as path from "path";

interface IndexField { fieldPath: string; order?: string; arrayConfig?: string }
interface Index { collectionGroup: string; queryScope: string; fields: IndexField[] }

const indexes: Index[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../firestore.indexes.json"), "utf8")
).indexes;

const has = (fields: IndexField[]): boolean =>
  indexes.some(
    (i) =>
      i.collectionGroup === "feedback" &&
      i.queryScope === "COLLECTION" &&
      JSON.stringify(i.fields) === JSON.stringify(fields)
  );

describe("feedback inbox indexes", () => {
  it("status + createdAt desc (the All filter)", () => {
    expect(
      has([
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("status + type + createdAt desc (a type filter)", () => {
    expect(
      has([
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "type", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ])
    ).toBe(true);
  });
});
