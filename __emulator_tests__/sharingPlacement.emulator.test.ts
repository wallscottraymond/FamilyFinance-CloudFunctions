/**
 * Emulator Integration Tests — Account-Rooted-Sharing Phase 2.1 (account placement)
 *
 * share_account → request → member Accept → placement; duplicate check (I4);
 * a normal full-doc account save keeps the placement; unshare.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern sharingPlacement"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();
// Same setting as production (src/index.ts).
db.settings({ ignoreUndefinedProperties: true });

import {
  get_my_connect_code_orchestrator,
  enter_connect_code_orchestrator,
} from "../src/functions/orchestrators/sharing/connect.orchestrator";
import { get_sharing_overview_orchestrator } from "../src/functions/orchestrators/sharing/connections.orchestrator";
import {
  create_group_orchestrator,
  respond_to_request_orchestrator,
} from "../src/functions/orchestrators/sharing/groups.orchestrator";
import {
  share_account_orchestrator,
  unshare_account_orchestrator,
} from "../src/functions/orchestrators/sharing/placement.orchestrator";
import { account_repo } from "../src/functions/repositories/account.repo";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `alex_${RUN}`;
const SAM = `sam_${RUN}`;
const JC_A = `jca_${RUN}`;
const JC_S = `jcs_${RUN}`;
const AMEX = `amex_${RUN}`;

function ctx<T>(user_id: string, input: T) {
  return {
    trace_id: `t_${Math.random()}`, span_id: `s_${Math.random()}`,
    user_id, input, idempotency_key: `k_${Math.random()}`,
  };
}
const overview = (u: string) => get_sharing_overview_orchestrator(ctx(u, {} as Record<string, never>));

function account_doc(id: string, user_id: string, name: string, mask: string, subtype: string) {
  const now = admin.firestore.Timestamp.now();
  return {
    id, userId: user_id, groupIds: [], isActive: true, isDeleted: false,
    createdAt: now, updatedAt: now, accountId: `plaid_${id}`, itemId: `item_${user_id}`,
    name, accountName: name, mask, accountType: subtype === "credit card" ? "credit" : "depository",
    accountSubtype: subtype, currentBalance: 100, institutionId: "ins_bank", institutionName: "Bank",
  };
}

const placement_of = async (id: string) =>
  (await db.collection("accounts").doc(id).get()).data()?.placement ?? null;

let group_id = "";

beforeAll(async () => {
  const b = db.batch();
  for (const u of [ALEX, SAM]) b.set(db.collection("users").doc(u), { email: `${u}@x.com` });
  b.set(db.collection("accounts").doc(JC_A), account_doc(JC_A, ALEX, "Joint Checking", "1234", "checking"));
  b.set(db.collection("accounts").doc(JC_S), account_doc(JC_S, SAM, "Joint Checking", "1234", "checking"));
  b.set(db.collection("accounts").doc(AMEX), account_doc(AMEX, SAM, "Amex", "7781", "credit card"));
  await b.commit();

  const a = (await get_my_connect_code_orchestrator(ctx(ALEX, { refresh: true }))).code;
  const s = (await get_my_connect_code_orchestrator(ctx(SAM, { refresh: true }))).code;
  await enter_connect_code_orchestrator(ctx(ALEX, { code: s }));
  await enter_connect_code_orchestrator(ctx(SAM, { code: a }));
  group_id = (await create_group_orchestrator(ctx(ALEX, { name: "The Walls", invitee_ids: [SAM] })))
    .group_id!;
  const r = (await overview(SAM)).requests[0];
  await respond_to_request_orchestrator(ctx(SAM, { request_id: r.id, accept: true }));
});

describe("account placement (emulator)", () => {
  it("T-AP-01 share → request to the other member; not shared until Accept", async () => {
    const res = await share_account_orchestrator(
      ctx(ALEX, { account_id: JC_A, group_id, include_history: false })
    );
    expect(res).toMatchObject({ success: true, status: "requested" });
    expect(await placement_of(JC_A)).toBeNull();
    const req = (await overview(SAM)).requests.find((r) => r.type === "share_account")!;
    expect(req.account_label).toBe("Joint Checking ••1234");
    expect(req.shared_from_ms).not.toBeNull();
  });

  it("only the owner can share; a second share while pending is refused", async () => {
    expect((await share_account_orchestrator(
      ctx(SAM, { account_id: JC_A, group_id, include_history: false })
    )).success).toBe(false);
    expect((await share_account_orchestrator(
      ctx(ALEX, { account_id: JC_A, group_id, include_history: true })
    )).success).toBe(false);
  });

  it("member Accept → placement set; request closed", async () => {
    const req = (await overview(SAM)).requests.find((r) => r.type === "share_account")!;
    const res = await respond_to_request_orchestrator(ctx(SAM, { request_id: req.id, accept: true }));
    expect(res.success).toBe(true);
    const p = await placement_of(JC_A);
    expect(p.groupId).toBe(group_id);
    expect(p.sharedBy).toBe(ALEX);
    expect((await overview(SAM)).requests).toEqual([]);
  });

  it("a normal full-doc account save keeps the share", async () => {
    const t = ctx(ALEX, {});
    const entity = (await account_repo.get_by_id(t, JC_A))!;
    await account_repo.save(t, { ...entity, name: "Joint Checking (renamed)" });
    expect((await placement_of(JC_A)).groupId).toBe(group_id);
  });

  it("T-AP-05 I4: Sam's copy of the same joint account is refused, naming who shares it", async () => {
    const res = await share_account_orchestrator(
      ctx(SAM, { account_id: JC_S, group_id, include_history: false })
    );
    expect(res.success).toBe(false);
    expect(res.already_shared_by?.user_id).toBe(ALEX);
    expect(await placement_of(JC_S)).toBeNull();
  });

  it("unshare → private again", async () => {
    expect((await unshare_account_orchestrator(ctx(SAM, { account_id: JC_A }))).success).toBe(false);
    expect((await unshare_account_orchestrator(ctx(ALEX, { account_id: JC_A }))).success).toBe(true);
    expect(await placement_of(JC_A)).toBeNull();
  });
});
