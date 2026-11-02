/**
 * Code-Health-Review E1-M1: `create_job_if_not_exists` treated a RUNNING job as a duplicate, so a
 * request arriving mid-run was dropped (the job read its state at start → the later change was
 * never processed; e.g. a quick Pause → Resume left the rollover on the paused state).
 *   - pending job with the key → merged (nothing created)
 *   - only a running job → ONE delayed follow-up queued behind it
 *   - nothing active → created now
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

import { create_job_if_not_exists, FOLLOW_UP_DELAY_SECONDS } from "../src/functions/infrastructure/job_queue";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const jobs_for = async (key: string) =>
  (await db.collection("_jobs").where("dedup_key", "==", `test_job::${key}`).get()).docs.map((d) => d.data());

describe("create_job_if_not_exists (E1-M1)", () => {
  it("nothing active → created now (no delay)", async () => {
    const key = `a_${RUN}`;
    const job = await create_job_if_not_exists("test_job", { deduplication_key: key });
    expect(job).not.toBeNull();
    const all = await jobs_for(key);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("pending");
  });

  it("a pending job covers a second request", async () => {
    const key = `b_${RUN}`;
    await create_job_if_not_exists("test_job", { deduplication_key: key });
    expect(await create_job_if_not_exists("test_job", { deduplication_key: key })).toBeNull();
    expect(await jobs_for(key)).toHaveLength(1);
  });

  it("a RUNNING job gets ONE delayed follow-up behind it (not dropped); more requests merge into it", async () => {
    const key = `c_${RUN}`;
    const first = await create_job_if_not_exists("test_job", { deduplication_key: key });
    await db.collection("_jobs").doc(first!.job_id).update({ status: "processing" });

    const follow = await create_job_if_not_exists("test_job", { deduplication_key: key });
    expect(follow).not.toBeNull();
    const all = await jobs_for(key);
    expect(all.map((j) => j.status).sort()).toEqual(["pending", "processing"]);
    const pending = all.find((j) => j.status === "pending")!;
    const created_ms = pending.created_at.toMillis();
    const run_after_ms = pending.scheduled_for.toMillis();
    expect(run_after_ms - created_ms).toBeGreaterThanOrEqual(FOLLOW_UP_DELAY_SECONDS * 1000 - 1000);

    expect(await create_job_if_not_exists("test_job", { deduplication_key: key })).toBeNull();
    expect(await jobs_for(key)).toHaveLength(2);
  });
});
