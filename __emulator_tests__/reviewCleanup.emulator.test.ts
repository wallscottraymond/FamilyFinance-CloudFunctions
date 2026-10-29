/**
 * Emulator — Bills-to-review cleanup (Convert-To-Recurring X19).
 *
 *   - Account removal closes that account's OPEN review items (answer `account_removed`), leaves
 *     other accounts' items and already-answered items alone.
 *   - (Purge of review items + state is covered in purgeUserData.emulator.test.ts.)
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern reviewCleanup"
 */
import * as admin from "firebase-admin";
import { remove_account_orchestrator } from "../src/functions/orchestrators/accounts/remove_account.orchestrator";
import { scenarioIds, seedScenario } from "./helpers/captureScenario";
import { recurring_review_repo } from "../src/functions/repositories/recurring_review.repo";
import { make_review_item, ReviewItem } from "../src/functions/domain/recurring/review_item.service";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

const item = (uid: string, subject: string, account: string, status: ReviewItem["status"] = "open"): ReviewItem =>
  make_review_item({
    user_id: uid, kind: "suggested", direction: "outflow", source: "plaid", status, answer: status === "open" ? null : "not_bill",
    subject_key: subject, vendor_key: subject, account_id: account, plaid_item_doc_id: "item", stream_id: `s_${subject}`,
    record_id: null, name: subject, amount: 10, frequency: "monthly", plaid_status: "EARLY_DETECTION", category: null,
    transaction_ids: [], next_due_ms: null, user_frequency: null, resolved_at_ms: status === "open" ? null : 1,
  }, Date.now());

describe("review items follow account removal (emulator)", () => {
  it("removing an account with NO saved bills / income still closes its open items (only those)", async () => {
    const ids = scenarioIds(`qzrc${Date.now() % 100000}`);
    await seedScenario(db, ids); // user + item with chk / sav / card; no outflows or inflows
    const uid = ids.userId;
    const a = item(uid, "outflow:avant", ids.chk);
    const b = item(uid, "outflow:hulu", ids.sav);
    const c = item(uid, "outflow:old", ids.chk, "dismissed");
    await recurring_review_repo.upsert_items(ctx(), [a, b, c]);
    const r = await remove_account_orchestrator(ctx(), uid, {
      account_id: ids.chk, idempotency_key: `rc_${Math.random()}`, removal_mode: "keep_history",
    } as never);
    expect(r.success).toBe(true);
    expect([r.outflow_count, r.inflow_count]).toEqual([0, 0]); // the recurring cascade never runs
    const got = await recurring_review_repo.get_items_by_ids(ctx(), [a.id, b.id, c.id]);
    expect(got.get(a.id)?.status).toBe("resolved");
    expect(got.get(a.id)?.answer).toBe("account_removed");
    expect((await db.collection("recurring_review_items").doc(a.id).get()).data()?.expireAt).toBeDefined();
    expect(got.get(b.id)?.status).toBe("open"); // another account's item
    expect(got.get(c.id)?.status).toBe("dismissed"); // the "Not a bill" memory is kept
    expect((await db.collection("recurring_review_items").doc(c.id).get()).data()?.expireAt).toBeUndefined();
  });
});

describe("robustness (emulator)", () => {
  it("flag doc missing / malformed fields → the check never throws and reads as off (what sync, detector and callable call)", async () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const ff = require("../src/functions/infrastructure/feature_flags");
    /* eslint-enable @typescript-eslint/no-var-requires */
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? "_feature_flags").doc("convert_to_recurring_v1").set({ enabled: true }); // no lists at all
    ff.invalidate_flag_cache();
    await expect(ff.is_convert_to_recurring_enabled("anyone")).resolves.toBe(false);
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? "_feature_flags").doc("convert_to_recurring_v1").set({ enabled: true, enabled_user_ids: "oops" });
    ff.invalidate_flag_cache();
    await expect(ff.is_convert_to_recurring_enabled("oops")).resolves.toBe(false);
    await db.collection(process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? "_feature_flags").doc("convert_to_recurring_v1").delete();
    ff.invalidate_flag_cache();
  });
});
