/**
 * Emulator Integration Tests — Account-Rooted-Sharing Phase 1
 *
 * Drives the sharing orchestrators against the Firestore emulator:
 * connect codes (both people type each other's code), groups, join requests +
 * Accept, the 3-group limit on create AND accept, ownership handover, leaving,
 * blocking. Test IDs refer to Account-Rooted-Sharing-Tests.md.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern sharingGroups"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import {
  get_my_connect_code_orchestrator,
  enter_connect_code_orchestrator,
} from "../src/functions/orchestrators/sharing/connect.orchestrator";
import {
  get_sharing_overview_orchestrator,
  manage_connection_orchestrator,
} from "../src/functions/orchestrators/sharing/connections.orchestrator";
import {
  create_group_orchestrator,
  add_to_group_orchestrator,
  respond_to_request_orchestrator,
  manage_group_orchestrator,
} from "../src/functions/orchestrators/sharing/groups.orchestrator";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const uid = (name: string) => `${name}_${RUN}`;
const ALEX = uid("alex");
const SAM = uid("sam");
const RILEY = uid("riley");
const JORDAN = uid("jordan");

function ctx<T>(user_id: string, input: T) {
  return {
    trace_id: `t_${Math.random()}`,
    span_id: `s_${Math.random()}`,
    user_id,
    input,
    idempotency_key: `k_${Math.random()}`,
  };
}

async function code_of(user_id: string): Promise<string> {
  return (await get_my_connect_code_orchestrator(ctx(user_id, { refresh: true }))).code;
}

async function connect(a: string, b: string): Promise<void> {
  const [code_a, code_b] = [await code_of(a), await code_of(b)];
  const first = await enter_connect_code_orchestrator(ctx(a, { code: code_b }));
  expect(first.outcome).toBe("waiting");
  const second = await enter_connect_code_orchestrator(ctx(b, { code: code_a }));
  expect(second.outcome).toBe("connected");
}

const overview = (user_id: string) =>
  get_sharing_overview_orchestrator(ctx(user_id, {} as Record<string, never>));

const group_ids_of = async (user_id: string): Promise<string[]> =>
  ((await db.collection("users").doc(user_id).get()).data()?.groupIds as string[]) ?? [];

async function accept_first_request(user_id: string, group_id: string) {
  const o = await overview(user_id);
  const r = o.requests.find((x) => x.group_id === group_id)!;
  expect(r).toBeDefined();
  return respond_to_request_orchestrator(ctx(user_id, { request_id: r.id, accept: true }));
}

beforeAll(async () => {
  const batch = db.batch();
  for (const u of [ALEX, SAM, RILEY, JORDAN]) {
    batch.set(db.collection("users").doc(u), { email: `${u}@example.com` });
  }
  await batch.commit();
});

describe("sharing Phase 1 (emulator)", () => {
  let walls = "";

  it("T-CN-01/02 both people type each other's code → connected; codes single-use", async () => {
    await connect(ALEX, SAM);
    const conn = await db.collection("connections").doc([ALEX, SAM].sort().join("__")).get();
    expect(conn.data()?.status).toBe("connected");
    const alex_code = (await db.collection("connect_codes").doc(ALEX).get()).data();
    expect(alex_code?.expiresAt.toMillis()).toBeLessThanOrEqual(Date.now());
    const o = await overview(ALEX);
    expect(o.connections.map((c) => c.person.user_id)).toEqual([SAM]);
    expect(JSON.stringify(o)).not.toContain("@example.com"); // D28: no emails
  });

  it("T-CN-05 own code → self; T-CN-04 garbage → malformed / invalid", async () => {
    const mine = await code_of(RILEY);
    expect((await enter_connect_code_orchestrator(ctx(RILEY, { code: mine }))).outcome)
      .toBe("self");
    expect((await enter_connect_code_orchestrator(ctx(RILEY, { code: "ab" }))).outcome)
      .toBe("malformed");
    expect((await enter_connect_code_orchestrator(ctx(RILEY, { code: "ZZZZZZ" }))).outcome)
      .toBe("invalid");
  });

  it("T-SP-01 create a group: owner + groupIds atomically; invite = pending request", async () => {
    const res = await create_group_orchestrator(
      ctx(ALEX, { name: "The Walls", invitee_ids: [SAM] })
    );
    expect(res.success).toBe(true);
    walls = res.group_id!;
    expect(await group_ids_of(ALEX)).toEqual([walls]);
    expect(await group_ids_of(SAM)).toEqual([]); // not until Sam accepts (D25)
    const o = await overview(SAM);
    expect(o.requests.map((r) => r.group_name)).toEqual(["The Walls"]);
  });

  it("can't invite someone you're not connected with", async () => {
    const res = await add_to_group_orchestrator(ctx(ALEX, { group_id: walls, invitee_id: RILEY }));
    expect(res.success).toBe(false);
  });

  it("T-SP-02 accept → member; request accepted; both see the group", async () => {
    const res = await accept_first_request(SAM, walls);
    expect(res.success).toBe(true);
    expect(await group_ids_of(SAM)).toEqual([walls]);
    const g = (await db.collection("groups").doc(walls).get()).data()!;
    expect(g.memberIds.sort()).toEqual([ALEX, SAM].sort());
    expect(g.members[SAM].role).toBe("full");
    const o = await overview(SAM);
    expect(o.groups.map((x) => x.name)).toEqual(["The Walls"]);
    expect(o.requests).toEqual([]);
  });

  it("T-SP-03 3-group limit on create", async () => {
    expect((await create_group_orchestrator(ctx(ALEX, { name: "Kids", invitee_ids: [] }))).success)
      .toBe(true);
    expect((await create_group_orchestrator(ctx(ALEX, { name: "Mom", invitee_ids: [] }))).success)
      .toBe(true);
    const fourth = await create_group_orchestrator(ctx(ALEX, { name: "Fourth", invitee_ids: [] }));
    expect(fourth.success).toBe(false);
    expect(fourth.errors?.[0]).toMatch(/up to 3 groups/);
    expect(await group_ids_of(ALEX)).toHaveLength(3);
  });

  it("T-SP-03 3-group limit on accept", async () => {
    await create_group_orchestrator(ctx(SAM, { name: "Sam A", invitee_ids: [] }));
    await create_group_orchestrator(ctx(SAM, { name: "Sam B", invitee_ids: [] }));
    expect(await group_ids_of(SAM)).toHaveLength(3);
    await connect(JORDAN, SAM);
    const j = await create_group_orchestrator(ctx(JORDAN, { name: "Jordan's", invitee_ids: [SAM] }));
    expect(j.success).toBe(true);
    const res = await accept_first_request(SAM, j.group_id!);
    expect(res.success).toBe(false);
    expect(res.errors?.[0]).toMatch(/up to 3 groups/);
    expect(await group_ids_of(SAM)).toHaveLength(3);
  });

  it("owner can't leave with members; hands over; then leaves", async () => {
    expect((await manage_group_orchestrator(ctx(ALEX, { group_id: walls, action: "leave" })))
      .success).toBe(false);
    expect((await manage_group_orchestrator(
      ctx(ALEX, { group_id: walls, action: "transfer_ownership", user_id: SAM })
    )).success).toBe(true);
    expect((await manage_group_orchestrator(ctx(ALEX, { group_id: walls, action: "leave" })))
      .success).toBe(true);
    expect(await group_ids_of(ALEX)).not.toContain(walls);
    const g = (await db.collection("groups").doc(walls).get()).data()!;
    expect(g.ownerId).toBe(SAM);
    expect(g.memberIds).toEqual([SAM]);
  });

  it("T-CN-12 block cancels pending requests and stops reconnecting", async () => {
    // Jordan's invite to Sam is still pending (Sam couldn't accept it).
    const before = await overview(SAM);
    expect(before.requests).toHaveLength(1);
    const blocked = await manage_connection_orchestrator(
      ctx(SAM, { action: "report", other_user_id: JORDAN, reason: "spam" })
    );
    expect(blocked.success).toBe(true);
    expect((await overview(SAM)).requests).toEqual([]);
    expect((await overview(SAM)).connections.map((c) => c.person.user_id)).not.toContain(JORDAN);
    const reports = await db.collection("reports").where("reportedId", "==", JORDAN).get();
    expect(reports.size).toBe(1);
    const code = await code_of(SAM);
    expect((await enter_connect_code_orchestrator(ctx(JORDAN, { code }))).outcome)
      .toBe("unavailable");
  });

  it("delete: owner only; everyone loses it", async () => {
    expect((await manage_group_orchestrator(ctx(SAM, { group_id: walls, action: "delete" })))
      .success).toBe(true);
    expect(await group_ids_of(SAM)).not.toContain(walls);
    expect((await overview(SAM)).groups.map((g) => g.id)).not.toContain(walls);
  });
});
