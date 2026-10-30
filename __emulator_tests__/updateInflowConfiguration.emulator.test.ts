/**
 * Income configuration edits (Code-Health-Review M2-M2 / M7-H1).
 *
 * - The "Regular Salary" toggle sent `{ incomeType: <the screen's default>, isRegularSalary }`; the
 *   server ignored isRegularSalary, reset the type and nulled every config block. A call carrying
 *   isRegularSalary now saves only that (older app builds send exactly that shape).
 * - Config blocks that weren't sent are kept.
 * - The period amounts were rewritten here from Plaid's average by a rule the period page never
 *   used (the user's expected amount ignored, received periods included). Now a config that
 *   implies an amount sets the income's expected amount (`expectedAmountOverride`), which the
 *   period page, stored periods and extenders all follow; nothing here writes period amounts.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { updateInflowConfiguration } from "../src/functions/inflows/inflow_periods/api/updateInflowConfiguration";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `ic_u_${RUN}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: unknown): Promise<any> => (updateInflowConfiguration as any).run({
  data, auth: { uid: U, token: {} }, rawRequest: {},
});
const read = async (id: string) => (await db.collection("inflows").doc(id).get()).data()!;
const readPeriod = async (id: string) => (await db.collection("inflow_periods").doc(id).get()).data()!;

/* eslint-disable @typescript-eslint/naming-convention */
async function seed(id: string, extra: Record<string, unknown> = {}) {
  await db.collection("inflows").doc(id).set({
    ownerId: U, userId: U, isActive: true, averageAmount: 2000, frequency: "BIWEEKLY",
    incomeType: "hourly", isRegularSalary: false,
    hourlyConfig: { hourlyRate: 30, expectedHoursPerPeriod: 70 },
    variableConfig: { useRollingAverage: true, rollingAveragePeriods: 3, userOverrideAmount: null },
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra,
  });
  await db.collection("inflow_periods").doc(`${id}_P1`).set({
    inflowId: id, ownerId: U, numberOfOccurrencesInPeriod: 2, amountPerOccurrence: 2000,
    totalAmountDue: 4000, totalAmountPaid: 2000, isPartiallyPaid: true, incomeType: "hourly",
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

describe("updateInflowConfiguration (emulator)", () => {
  afterAll(async () => { await db.terminate(); });

  it("the Regular Salary toggle saves only isRegularSalary (type + configs kept)", async () => {
    const id = `ic_toggle_${RUN}`;
    await seed(id);
    // Exactly what the app's toggle sends (the screen defaults its type to OTHER).
    await call({ inflowId: id, incomeType: "other", isRegularSalary: true });
    const doc = await read(id);
    expect(doc.isRegularSalary).toBe(true);
    expect(doc.incomeType).toBe("hourly");
    expect(doc.hourlyConfig).toEqual({ hourlyRate: 30, expectedHoursPerPeriod: 70 });
    expect(doc.variableConfig).toMatchObject({ useRollingAverage: true });
    expect(doc.expectedAmountOverride).toBeUndefined();
    expect((await readPeriod(`${id}_P1`)).totalAmountDue).toBe(4000);
  });

  it("the toggle works without an incomeType", async () => {
    const id = `ic_toggle2_${RUN}`;
    await seed(id);
    await call({ inflowId: id, isRegularSalary: true });
    expect((await read(id)).isRegularSalary).toBe(true);
  });

  it("a config that implies an amount sets the expected amount; other configs are kept", async () => {
    const id = `ic_hourly_${RUN}`;
    await seed(id);
    const res = await call({ inflowId: id, incomeType: "hourly", hourlyConfig: { hourlyRate: 40, expectedHoursPerPeriod: 80 } });
    const doc = await read(id);
    expect(doc.hourlyConfig).toEqual({ hourlyRate: 40, expectedHoursPerPeriod: 80 });
    expect(doc.variableConfig).toMatchObject({ useRollingAverage: true }); // not nulled
    expect(doc.expectedAmountOverride).toBe(3200);
    expect(res.newPrediction.expectedAmount).toBe(3200);
    // Period amounts are not rewritten here (the definition's expected amount drives them).
    const p = await readPeriod(`${id}_P1`);
    expect(p.totalAmountDue).toBe(4000);
    expect(p.totalAmountPaid).toBe(2000);
    expect(p.incomeType).toBe("hourly");
  });

  it("a fixed type keeps the user's expected amount (no override written from Plaid's average)", async () => {
    const id = `ic_salary_${RUN}`;
    await seed(id, { expectedAmountOverride: 2600 });
    const res = await call({ inflowId: id, incomeType: "salary" });
    const doc = await read(id);
    expect(doc.incomeType).toBe("salary");
    expect(doc.expectedAmountOverride).toBe(2600);
    expect(res.newPrediction.expectedAmount).toBe(2600);
    expect(doc.hourlyConfig).toEqual({ hourlyRate: 30, expectedHoursPerPeriod: 70 });
    expect((await readPeriod(`${id}_P1`)).incomeType).toBe("salary");
  });

  // Batch 5 verify: the app sends the stored configs back on every save, so only a config the
  // user CHANGED may set the expected amount — saving unchanged must keep a later amount edit.
  it("an unchanged config never overwrites the expected amount", async () => {
    const id = `ic_same_${RUN}`;
    const variableConfig = { useRollingAverage: false, rollingAveragePeriods: 3, userOverrideAmount: 1500 };
    await seed(id, { incomeType: "freelance", variableConfig, expectedAmountOverride: 1800, hourlyConfig: null });
    // Sent in a different key order than stored (Firestore returns map keys in its own order).
    const res = await call({ inflowId: id, incomeType: "freelance",
      variableConfig: { userOverrideAmount: 1500, rollingAveragePeriods: 3, useRollingAverage: false } });
    expect((await read(id)).expectedAmountOverride).toBe(1800);
    expect(res.newPrediction.expectedAmount).toBe(1800);
  });

  it("a changed config does set it", async () => {
    const id = `ic_changed_${RUN}`;
    await seed(id, {
      incomeType: "freelance", expectedAmountOverride: 1800, hourlyConfig: null,
      variableConfig: { useRollingAverage: false, rollingAveragePeriods: 3, userOverrideAmount: 1500 },
    });
    await call({ inflowId: id, incomeType: "freelance",
      variableConfig: { useRollingAverage: false, rollingAveragePeriods: 3, userOverrideAmount: 1650 } });
    expect((await read(id)).expectedAmountOverride).toBe(1650);
  });

  it("refuses another user's income", async () => {
    const id = `ic_other_${RUN}`;
    await seed(id, { ownerId: "someone_else", userId: "someone_else" });
    await expect(call({ inflowId: id, isRegularSalary: true })).rejects.toMatchObject({ code: "permission-denied" });
  });
});
