/**
 * Emulator Integration Tests — Website Waitlist
 *
 * Runs the join-waitlist orchestrator against the Firestore emulator: real transaction, real docs.
 *
 * Prereq: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { join_waitlist_orchestrator } from "../src/functions/orchestrators/waitlist/join_waitlist.orchestrator";
import { entry_id } from "../src/functions/domain/waitlist/waitlist.service";
import { create_trace_context } from "../src/functions/observability";
import {
  join_waitlist_input_schema,
  MAX_ATTEMPTS_PER_IP_PER_DAY,
  MAX_NEW_SIGNUPS_PER_DAY,
} from "../src/functions/types/waitlist.types";

const NOW = Date.UTC(2026, 10, 2, 15, 30);
const DAY = "2026-11-02";
const input = (email: string, extra: object = {}) =>
  join_waitlist_input_schema.parse({ email, ...extra });
const join = (email: string, ip: string, extra: object = {}, now = NOW) =>
  join_waitlist_orchestrator(create_trace_context(false), input(email, extra), ip, now);

describe("join_waitlist", () => {
  it("stores one entry, with only the expected fields", async () => {
    expect(await join("new@example.com", "10.0.0.1", { source: "footer" })).toBe("joined");
    const snap = await db.collection("waitlist").doc(entry_id("new@example.com")).get();
    expect(snap.exists).toBe(true);
    expect(Object.keys(snap.data()!).sort()).toEqual(["createdAt", "email", "source", "status"]);
    expect(snap.data()).toMatchObject({
      email: "new@example.com", source: "footer", status: "waiting",
    });
  });

  it("a different capitalization of the same address is the same entry", async () => {
    expect(await join("Twice@Example.com", "10.0.0.2")).toBe("joined");
    expect(await join("twice@example.com", "10.0.0.2")).toBe("already_joined");
    const all = await db.collection("waitlist").where("email", "==", "twice@example.com").get();
    expect(all.size).toBe(1);
  });

  it("a repeat keeps the original entry untouched", async () => {
    await join("keep@example.com", "10.0.0.3", { source: "hero" });
    const ref = db.collection("waitlist").doc(entry_id("keep@example.com"));
    const before = (await ref.get()).data();
    await join("keep@example.com", "10.0.0.3", { source: "footer" }, NOW + 1000);
    expect((await ref.get()).data()).toEqual(before);
  });

  it("simultaneous submits of one address make one entry", async () => {
    const results = await Promise.all([
      join("race@example.com", "10.0.0.4"),
      join("race@example.com", "10.0.0.5"),
      join("race@example.com", "10.0.0.6"),
    ]);
    expect(results.filter((r) => r === "joined")).toHaveLength(1);
    const all = await db.collection("waitlist").where("email", "==", "race@example.com").get();
    expect(all.size).toBe(1);
  });

  it("the honeypot stores nothing and touches no counter", async () => {
    const limits_before = (await db.collection("_waitlist_limits").get()).size;
    expect(await join("bot@example.com", "10.0.0.7", { company: "Acme" })).toBe("ignored");
    const snap = await db.collection("waitlist").doc(entry_id("bot@example.com")).get();
    expect(snap.exists).toBe(false);
    expect((await db.collection("_waitlist_limits").get()).size).toBe(limits_before);
  });

  it("one network is stopped at the limit; another still gets through; no address is stored", async () => {
    const ip = "10.0.1.1";
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_PER_DAY; i++) {
      expect(await join(`n${i}@example.com`, ip)).toBe("joined");
    }
    expect(await join("over@example.com", ip)).toBe("rate_limited");
    const over = await db.collection("waitlist").doc(entry_id("over@example.com")).get();
    expect(over.exists).toBe(false);
    expect(await join("over@example.com", "10.0.1.2")).toBe("joined");

    const limits = await db.collection("_waitlist_limits").get();
    for (const doc of limits.docs) {
      expect(JSON.stringify(doc.data()) + doc.id).not.toContain("10.0.1");
      if (doc.id !== "global") expect(doc.data().expire_at).toBeInstanceOf(admin.firestore.Timestamp);
    }
  });

  it("the daily cap stops new entries only, and clears the next day", async () => {
    await db.collection("_waitlist_limits").doc("global").set({
      day: DAY, count: MAX_NEW_SIGNUPS_PER_DAY,
    });
    expect(await join("capped@example.com", "10.0.2.1")).toBe("rate_limited");
    expect(await join("capped@example.com", "10.0.2.1", {}, NOW + 86_400_000)).toBe("joined");
    const global = await db.collection("_waitlist_limits").doc("global").get();
    expect(global.data()).toEqual({ day: "2026-11-03", count: 1 });
  });
});
