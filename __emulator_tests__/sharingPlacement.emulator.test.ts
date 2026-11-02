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
  manage_group_orchestrator,
  add_to_group_orchestrator,
} from "../src/functions/orchestrators/sharing/groups.orchestrator";
import {
  share_account_orchestrator,
  unshare_account_orchestrator,
} from "../src/functions/orchestrators/sharing/placement.orchestrator";
import { account_repo } from "../src/functions/repositories/account.repo";
import { request_repo } from "../src/functions/repositories/sharing";
import { restore_account_orchestrator } from "../src/functions/orchestrators/accounts/restore_account.orchestrator";

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
    const clear_reassign_jobs = async () => {
      // Only THIS suite's users' jobs (other suites share the emulator).
      const old = await db.collection("_jobs").where("job_type", "==", "reassign_user").get();
      await Promise.all(old.docs
        .filter((d) => [ALEX, SAM].includes(d.data().payload?.user_id))
        .map((d) => d.ref.delete()));
    };
    expect((await unshare_account_orchestrator(ctx(SAM, { account_id: JC_A }))).success).toBe(false);
    await clear_reassign_jobs(); // the earlier Accept queued one — prove THIS action queues its own
    expect((await unshare_account_orchestrator(ctx(ALEX, { account_id: JC_A }))).success).toBe(true);
    expect(await placement_of(JC_A)).toBeNull();
    // Its transactions are re-assigned back to Alex's Me view: a re-assign run scoped to it.
    const jobs = (await db.collection("_jobs").where("job_type", "==", "reassign_user").get()).docs
      .map((d) => d.data().payload).filter((p) => p?.user_id === ALEX);
    expect(jobs.some((p) => (p.scope?.account_ids ?? []).includes(JC_A))).toBe(true);
  });
});

describe("departures (D13, emulator)", () => {
  async function share_and_accept(owner: string, other: string, account_id: string) {
    const res = await share_account_orchestrator(
      ctx(owner, { account_id, group_id, include_history: true })
    );
    expect(res.success).toBe(true);
    const req = (await overview(other)).requests.find((r) => r.type === "share_account")!;
    await respond_to_request_orchestrator(ctx(other, { request_id: req.id, accept: true }));
    expect((await placement_of(account_id)).groupId).toBe(group_id);
  }

  it("T-LV-01 Sam leaves → his shared Amex goes private; Alex's account stays shared", async () => {
    await share_and_accept(SAM, ALEX, AMEX);
    await share_and_accept(ALEX, SAM, JC_A);
    const clear_reassign_jobs = async () => {
      // Only THIS suite's users' jobs (other suites share the emulator).
      const old = await db.collection("_jobs").where("job_type", "==", "reassign_user").get();
      await Promise.all(old.docs
        .filter((d) => [ALEX, SAM].includes(d.data().payload?.user_id))
        .map((d) => d.ref.delete()));
    };
    await clear_reassign_jobs(); // the Accepts above queued some — prove leaving queues its own
    const old_classify = await db.collection("_jobs").where("job_type", "==", "classify_transfers").get();
    await Promise.all(old_classify.docs.filter((d) => [ALEX, SAM].includes(d.data().payload?.user_id)).map((d) => d.ref.delete()));
    const left_at = Date.now() - 1000;
    expect((await manage_group_orchestrator(ctx(SAM, { group_id, action: "leave" }))).success)
      .toBe(true);
    expect(await placement_of(AMEX)).toBeNull();
    expect((await placement_of(JC_A)).groupId).toBe(group_id);
    // Sam's Amex transactions are re-assigned back to Sam's Me view.
    const jobs = (await db.collection("_jobs").where("job_type", "==", "reassign_user").get()).docs
      .map((d) => d.data().payload).filter((p) => p?.user_id === SAM);
    expect(jobs.some((p) => (p.scope?.account_ids ?? []).includes(AMEX))).toBe(true);
    // ALEX STAYS — but a transfer between Sam's and Alex's accounts may now cross the group's
    // boundary: Alex's transfer roles are refreshed too.
    const classify = (await db.collection("_jobs").where("job_type", "==", "classify_transfers").get()).docs
      .map((d) => d.data()).filter((j) => j.payload?.user_id === ALEX && j.created_at.toMillis() >= left_at);
    expect(classify.length).toBeGreaterThan(0);
  });

  it("delete → every account in the group goes private", async () => {
    expect((await manage_group_orchestrator(ctx(ALEX, { group_id, action: "delete" }))).success)
      .toBe(true);
    expect(await placement_of(JC_A)).toBeNull();
  });
});

/**
 * Code-Health-Review batch 10 (sharing edges).
 *   S1-H1: the same real account (bank + last 4 + subtype) can't end up placed twice in a group —
 *          refused at send when a copy is WAITING for an Accept, and re-checked at accept (inside
 *          the placement transaction) for copies sent before either was accepted.
 *   S1-M3: a share request goes to every member; a member NOT connected to the sharer can accept
 *          (membership in the group is the authority).
 * Quinn owns the group and is connected to Pat and Remy; Pat and Remy are NOT connected.
 */
describe("sharing edges (batch 10, emulator)", () => {
  const PAT = `pat_${RUN}`;
  const QUINN = `quinn_${RUN}`;
  const REMY = `remy_${RUN}`;
  const acc = (k: string) => `${k}_${RUN}`;
  let gid = "";

  const connect = async (a: string, b: string) => {
    const ca = (await get_my_connect_code_orchestrator(ctx(a, { refresh: true }))).code;
    const cb = (await get_my_connect_code_orchestrator(ctx(b, { refresh: true }))).code;
    await enter_connect_code_orchestrator(ctx(a, { code: cb }));
    await enter_connect_code_orchestrator(ctx(b, { code: ca }));
  };
  const share_request = async (to: string, account_id: string) => {
    const q = await db.collection("requests").where("targetId", "==", account_id)
      .where("status", "==", "pending").get();
    const doc = q.docs.find((d) => d.data().toUserId === to);
    // Also listed in the recipient's overview (what the app shows).
    if (doc) expect((await overview(to)).requests.some((r) => r.id === doc.id)).toBe(true);
    return { id: doc!.id };
  };

  beforeAll(async () => {
    const b = db.batch();
    for (const u of [PAT, QUINN, REMY]) b.set(db.collection("users").doc(u), { email: `${u}@x.com` });
    // Two copies of one joint account (Pat's + Quinn's), twice (mask 4321 / 8765), and one of
    // Pat's own accounts for the not-connected accept.
    b.set(db.collection("accounts").doc(acc("p1")), account_doc(acc("p1"), PAT, "Joint", "4321", "checking"));
    b.set(db.collection("accounts").doc(acc("q1")), account_doc(acc("q1"), QUINN, "Joint", "4321", "checking"));
    b.set(db.collection("accounts").doc(acc("p2")), account_doc(acc("p2"), PAT, "Joint 2", "8765", "checking"));
    b.set(db.collection("accounts").doc(acc("q2")), account_doc(acc("q2"), QUINN, "Joint 2", "8765", "checking"));
    b.set(db.collection("accounts").doc(acc("p3")), account_doc(acc("p3"), PAT, "Pat Visa", "1111", "credit card"));
    await b.commit();
    await connect(QUINN, PAT);
    await connect(QUINN, REMY);
    gid = (await create_group_orchestrator(ctx(QUINN, { name: "Edges", invitee_ids: [PAT, REMY] })))
      .group_id!;
    for (const u of [PAT, REMY]) {
      const r = (await overview(u)).requests.find((x) => x.type === "join_group")!;
      expect((await respond_to_request_orchestrator(ctx(u, { request_id: r.id, accept: true }))).success)
        .toBe(true);
    }
  });

  it("S1-M3 Remy (not connected to Pat) accepts Pat's share — membership is the authority", async () => {
    expect((await share_account_orchestrator(
      ctx(PAT, { account_id: acc("p3"), group_id: gid, include_history: false })
    )).success).toBe(true);
    const req = await share_request(REMY, acc("p3"));
    expect(req).toBeDefined();
    const res = await respond_to_request_orchestrator(ctx(REMY, { request_id: req.id, accept: true }));
    expect(res).toMatchObject({ success: true });
    expect((await placement_of(acc("p3"))).groupId).toBe(gid);
  });

  it("S1-H1 send: a copy of an account that's WAITING for an Accept is refused, naming the sender", async () => {
    expect((await share_account_orchestrator(
      ctx(PAT, { account_id: acc("p1"), group_id: gid, include_history: false })
    ))).toMatchObject({ success: true, status: "requested" });
    const res = await share_account_orchestrator(
      ctx(QUINN, { account_id: acc("q1"), group_id: gid, include_history: false })
    );
    expect(res.success).toBe(false);
    expect(res.errors?.[0]).toMatch(/waiting for an Accept/);
    expect(res.already_shared_by?.user_id).toBe(PAT);
    expect((await db.collection("requests").where("targetId", "==", acc("q1")).get()).size).toBe(0);
  });

  it("S1-H1 accept: two copies sent before either was accepted → the second accept is refused", async () => {
    // Quinn's copy was sent in the race window (both sends passed the check before either landed).
    const now = Date.now();
    await request_repo.save_many(ctx(QUINN, {}), [PAT, REMY].map((to, i) => ({
      id: `race_${i}_${RUN}`, type: "share_account" as const, from_user_id: QUINN, to_user_id: to,
      group_id: gid, target_id: acc("q1"), target_label: "Joint ••4321", shared_from_ms: null,
      status: "pending" as const, created_at_ms: now, expires_at_ms: now + 86_400_000,
      responded_at_ms: null,
    })));
    const pats = await share_request(QUINN, acc("p1"));
    expect((await respond_to_request_orchestrator(ctx(QUINN, { request_id: pats.id, accept: true })))
      .success).toBe(true);
    const res = await respond_to_request_orchestrator(ctx(PAT, { request_id: `race_0_${RUN}`, accept: true }));
    expect(res.success).toBe(false);
    expect(res.errors?.[0]).toMatch(/already shares this account/);
    expect(await placement_of(acc("q1"))).toBeNull();
    // The refused copy's requests are closed, so nobody else can try it either.
    const left = await db.collection("requests").where("targetId", "==", acc("q1"))
      .where("status", "==", "pending").get();
    expect(left.size).toBe(0);
  });

  it("S1-H1 accept race: both copies accepted AT ONCE → exactly one is placed", async () => {
    const now = Date.now();
    const seed = (id: string, from: string, to: string, target: string) => ({
      id, type: "share_account" as const, from_user_id: from, to_user_id: to, group_id: gid,
      target_id: target, target_label: "Joint 2 ••8765", shared_from_ms: null,
      status: "pending" as const, created_at_ms: now, expires_at_ms: now + 86_400_000,
      responded_at_ms: null,
    });
    // Accepted by people connected to the senders (so only the duplicate rule can refuse).
    await request_repo.save_many(ctx(PAT, {}), [
      seed(`rp2_${RUN}`, PAT, QUINN, acc("p2")),
      seed(`rq2_${RUN}`, QUINN, PAT, acc("q2")),
    ]);
    const results = await Promise.all([
      respond_to_request_orchestrator(ctx(QUINN, { request_id: `rp2_${RUN}`, accept: true })),
      respond_to_request_orchestrator(ctx(PAT, { request_id: `rq2_${RUN}`, accept: true })),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const placed = [await placement_of(acc("p2")), await placement_of(acc("q2"))].filter(Boolean);
    expect(placed).toHaveLength(1);
  });

  // Batch 10 verify H1: a restore is a placement coming back into effect.
  const restore = (user: string, account_id: string) =>
    restore_account_orchestrator(
      { trace_id: `t_${Math.random()}`, span_id: "s" },
      user,
      {
        account_id, idempotency_key: `rs_${Math.random()}`,
        restore_transactions: false, restore_recurring: false,
      }
    );
  const reason = (r: unknown) => (r as { made_private_reason?: string | null }).made_private_reason ?? null;
  const remove = (user: string, id: string) =>
    account_repo.soft_delete({ trace_id: `t_${Math.random()}`, span_id: "s" }, id, user);
  async function seed_placed(id: string, owner: string, mask: string, group: string) {
    const now = admin.firestore.Timestamp.now();
    const item = `item_${owner}`;
    await db.collection("plaid_items").doc(item).set({
      id: item, plaidItemId: item, userId: owner, isActive: true, createdAt: now, updatedAt: now,
    });
    await db.collection("accounts").doc(id).set({
      ...account_doc(id, owner, "Copy", mask, "savings"),
      placement: { groupId: group, sharedFrom: null, sharedBy: owner, sharedAt: now },
    });
  }

  it("verify H1: restoring a copy while another copy is in the group → back PRIVATE, with a reason", async () => {
    await seed_placed(acc("ra"), PAT, "2468", gid); // Pat's copy, in the group
    await remove(PAT, acc("ra")); // removed: placement kept, not counted
    await seed_placed(acc("rb"), QUINN, "2468", gid); // meanwhile Quinn's copy joined
    const clean = async () => {
      const old = await db.collection("_jobs").where("job_type", "==", "reassign_user").get();
      await Promise.all(old.docs.filter((d) => d.data().payload?.user_id === PAT).map((d) => d.ref.delete()));
    };
    await clean();

    const res = await restore(PAT, acc("ra"));
    expect(res.success).toBe(true);
    expect(reason(res)).toMatch(/already shares this account/);
    const doc = (await db.collection("accounts").doc(acc("ra")).get()).data()!;
    expect(doc.isActive).toBe(true);
    expect(doc.isDeleted).toBe(false);
    expect(doc.placement).toBeNull();
    expect((await placement_of(acc("rb"))).groupId).toBe(gid);
    // Its transactions are re-assigned back to Pat's Me view.
    const jobs = (await db.collection("_jobs").where("job_type", "==", "reassign_user").get()).docs
      .map((d) => d.data().payload).filter((p) => p?.user_id === PAT);
    expect(jobs.some((p) => (p.scope?.account_ids ?? []).includes(acc("ra")))).toBe(true);
  });

  it("verify H1: no other copy → it comes back still shared; a private one comes back private", async () => {
    await seed_placed(acc("rc"), PAT, "1357", gid);
    await remove(PAT, acc("rc"));
    const res = await restore(PAT, acc("rc"));
    expect(reason(res)).toBeNull();
    expect((await placement_of(acc("rc"))).groupId).toBe(gid);
    expect((await db.collection("accounts").doc(acc("rc")).get()).data()!.isActive).toBe(true);
  });

  it("verify H1: restored after leaving the group → private, so rejoining can't silently re-share", async () => {
    await seed_placed(acc("rd"), PAT, "1122", "some_other_group");
    await remove(PAT, acc("rd"));
    const res = await restore(PAT, acc("rd"));
    expect(reason(res)).toMatch(/no longer in that group/);
    expect(await placement_of(acc("rd"))).toBeNull();
  });

  // Batch 10 verify #2 M1: leave → rejoin → restore must never re-share without an Accept.
  describe("a removed account's placement ends with the membership", () => {
    async function group_with_pat(name: string) {
      const g = (await create_group_orchestrator(ctx(QUINN, { name, invitee_ids: [PAT] }))).group_id!;
      const q = await db.collection("requests").where("groupId", "==", g)
        .where("toUserId", "==", PAT).where("status", "==", "pending").get();
      expect((await respond_to_request_orchestrator(ctx(PAT, { request_id: q.docs[0].id, accept: true }))).success)
        .toBe(true);
      return g;
    }

    it.each([
      ["leave", (g: string) => ctx(PAT, { group_id: g, action: "leave" as const })],
      ["removed", (g: string) => ctx(QUINN, { group_id: g, action: "remove_member" as const, user_id: PAT })],
      ["group deleted", (g: string) => ctx(QUINN, { group_id: g, action: "delete" as const })],
    ])("%s: the removed account's placement is cleared; restoring it comes back private", async (label, action) => {
      const g = await group_with_pat(`M1 ${label}`);
      const id = acc(`m1_${label.replace(" ", "_")}`);
      await seed_placed(id, PAT, `9${label.length}01`, g);
      await remove(PAT, id);
      expect((await placement_of(id)).groupId).toBe(g); // removing keeps it
      expect((await manage_group_orchestrator(action(g))).success).toBe(true);
      expect(await placement_of(id)).toBeNull();

      const res = await restore(PAT, id);
      expect(res.success).toBe(true);
      expect(await placement_of(id)).toBeNull();
      await manage_group_orchestrator(ctx(QUINN, { group_id: g, action: "delete" })); // group limit
    });

    it("the full path: leave, rejoin, restore → NOT shared", async () => {
      const g = await group_with_pat("M1 rejoin");
      const id = acc("m1_rejoin");
      await seed_placed(id, PAT, "9777", g);
      await remove(PAT, id);
      await manage_group_orchestrator(ctx(PAT, { group_id: g, action: "leave" }));
      await add_to_group_orchestrator(ctx(QUINN, { group_id: g, invitee_id: PAT }));
      const q = await db.collection("requests").where("groupId", "==", g)
        .where("toUserId", "==", PAT).where("status", "==", "pending").get();
      await respond_to_request_orchestrator(ctx(PAT, { request_id: q.docs[0].id, accept: true }));
      await restore(PAT, id);
      expect(await placement_of(id)).toBeNull();
      await manage_group_orchestrator(ctx(QUINN, { group_id: g, action: "delete" })); // group limit
    });

    it("an account removed before this fix (placement never cleared) is caught by the joined date", async () => {
      const g = await group_with_pat("M1 legacy");
      const id = acc("m1_legacy");
      await seed_placed(id, PAT, "9888", g);
      await db.collection("accounts").doc(id).update({
        "placement.sharedAt": admin.firestore.Timestamp.fromMillis(Date.now() - 86_400_000),
      });
      await remove(PAT, id);
      const res = await restore(PAT, id);
      expect(reason(res)).toMatch(/left that group/);
      expect(await placement_of(id)).toBeNull();
      await manage_group_orchestrator(ctx(QUINN, { group_id: g, action: "delete" }));
    });

    it("another member's active + removed accounts survive someone else leaving", async () => {
      const g = await group_with_pat("M1 others");
      const id = acc("m1_others");
      await seed_placed(id, QUINN, "9999", g);
      await remove(QUINN, id);
      await manage_group_orchestrator(ctx(PAT, { group_id: g, action: "leave" }));
      expect((await placement_of(id)).groupId).toBe(g); // Quinn is still a member
      await manage_group_orchestrator(ctx(QUINN, { group_id: g, action: "delete" }));
      expect(await placement_of(id)).toBeNull();
    });
  });
});
