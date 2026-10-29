/**
 * Emulator — Add Bill and Add Income are byte-identical with the flag OFF (Convert-To-Recurring
 * Phase 2, D43 + the review's "flag-off golden"). The golden `golden/addBillUnchanged.golden.json`
 * was produced at the Phase 2 base (4c11ad0 behavior) with ADDBILL_GOLDEN_WRITE=1, BEFORE the D43
 * swap landed. The swap (commit 8) is flag-gated, so with no flag doc / a flag doc that doesn't list
 * the user, both callables must keep producing exactly this: the stored doc (every field) and the
 * period page's derive rows for it (monthly, weekly view not needed — on-read, no stored periods).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern addBillUnchanged"
 */
import * as fs from "fs";
import * as path from "path";
import * as admin from "firebase-admin";
import { NOW_MS, normalizeDoc, scenarioIds, seedMonthlySourcePeriods, seedScenario } from "./helpers/captureScenario";

const GOLDEN = path.join(__dirname, "golden", "addBillUnchanged.golden.json");
const WRITE = process.env.ADDBILL_GOLDEN_WRITE === "1";

let db: FirebaseFirestore.Firestore;
/* eslint-disable @typescript-eslint/no-explicit-any */
let derive_period_orchestrator: any;
let create_manual_outflow: any;
let createManualInflow: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers({
    now: NOW_MS, advanceTimers: true,
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"],
  });
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  /* eslint-disable @typescript-eslint/no-var-requires */
  ({ derive_period_orchestrator } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ create_manual_outflow } = require("../src/functions/entry/callable/create_manual_outflow.entry"));
  ({ createManualInflow } = require("../src/functions/inflows/inflow_periods/api/createManualInflow"));
  /* eslint-enable @typescript-eslint/no-var-requires */
  await seedMonthlySourcePeriods(db, [[2037, 9], [2037, 10], [2037, 11]]);
}, 60000);
afterAll(() => jest.useRealTimers());

const OCT = { start: Date.UTC(2037, 9, 1), end: Date.UTC(2037, 10, 1) - 1 };

describe("Add Bill / Add Income with the flag OFF are unchanged (D43 golden)", () => {
  it("stored docs + derive rows equal the Phase 2 base", async () => {
    const tag = "qzaddbill";
    const ids = scenarioIds(tag);
    await seedScenario(db, ids);
    // The flag doc may exist (other suites) but must not list this user: flag OFF.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../src/functions/infrastructure/feature_flags").invalidate_flag_cache();
    const uid = ids.userId;
    const auth = { uid, token: {} };
    const bill = async (data: Record<string, unknown>) =>
      (await create_manual_outflow.run({ auth, data, rawRequest: {} })).data.outflow_id as string;
    const income = async (data: Record<string, unknown>) =>
      (await createManualInflow.run({ auth, data, rawRequest: {} })).inflowId as string;

    const b1 = await bill({ name: "Rent", amount: 1200, frequency: "monthly", due_day: 20, expense_type: "housing", is_essential: true });
    const b2 = await bill({ name: "Dog sitter", merchant_name: "Rover", amount: 40, frequency: "weekly" });
    const b3 = await bill({ name: "Gym", amount: 25, frequency: "bi_weekly" });
    const i1 = await income({ name: "Day job", amount: 2000, frequency: "MONTHLY", firstExpectedDate: "2037-10-20", incomeType: "salary", accountId: ids.chk });
    const i2 = await income({
      name: "Tutoring", amount: 300, frequency: "WEEKLY", firstExpectedDate: "2037-10-16", incomeType: "hourly",
      hourlyConfig: { rate: 30, hours: 10 }, incomeVariability: "high",
    });
    const order = [b1, b2, b3, i1, i2];
    const label = (s: string) => order.reduce((acc, id, n) => acc.split(id).join(`ID${n}`), s);

    const docs: Record<string, unknown> = {};
    for (const [n, id] of order.entries()) {
      const coll = n < 3 ? "outflows" : "inflows";
      docs[`ID${n}`] = normalizeDoc((await db.collection(coll).doc(id).get()).data(), tag);
    }
    const derived = await derive_period_orchestrator({ trace_id: "ab", span_id: "s" }, uid, {
      view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, force: true,
    });
    const mine = new Set(order);
    const rows = {
      bills: derived.bills.filter((b: { recurring_id: string }) => mine.has(b.recurring_id)),
      income: derived.income.filter((b: { recurring_id: string }) => mine.has(b.recurring_id)),
    };
    const dump = JSON.parse(label(JSON.stringify({ docs: normalizeDoc(docs, tag), rows: normalizeDoc(rows, tag) })));
    // The page lists rows in an id-dependent order (the ids are random): compare by label.
    const by_label = (a: { recurring_id: string }, b: { recurring_id: string }) => (a.recurring_id < b.recurring_id ? -1 : 1);
    dump.rows.bills.sort(by_label);
    dump.rows.income.sort(by_label);

    if (WRITE) {
      fs.writeFileSync(GOLDEN, JSON.stringify(dump, null, 1));
      return;
    }
    expect(dump).toEqual(JSON.parse(fs.readFileSync(GOLDEN, "utf8")));
  }, 120000);
});
