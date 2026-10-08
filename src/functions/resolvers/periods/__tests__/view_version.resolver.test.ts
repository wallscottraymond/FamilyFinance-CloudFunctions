/**
 * resolve_view_version — Me view (Performance-Review-4 G7). Me pairs transfers against other
 * group members' transactions, so a partner's version / membership must move the Me version;
 * a user in no group keeps their plain own version (existing caches stay valid).
 */
const versions: Record<string, number> = {};
const get_user = jest.fn();
const get_many = jest.fn();

jest.mock("../../../repositories/derive_version.repo", () => ({
  get_derive_version: jest.fn(async (id: string) => versions[id] ?? 0),
}));
jest.mock("../../../repositories/user.repo", () => ({
  user_repo: { get_by_id: (...a: unknown[]) => get_user(...a) },
}));
jest.mock("../../../repositories/sharing", () => ({
  group_repo: { get_many: (...a: unknown[]) => get_many(...a), get: jest.fn() },
}));

import { resolve_view_version } from "../view_version.resolver";
import { create_trace_context } from "../../../observability";

const grp = (id: string, ids: string[]) => ({
  id,
  name: id,
  deleted_at_ms: null,
  member_ids: ids,
  members: Object.fromEntries(ids.map((m) => [m, { role: "member" }])),
});
const ctx = create_trace_context(false);
const me = async () => (await resolve_view_version(ctx, "alex", undefined)).version;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(versions, { alex: 7, sam: 3 });
});

describe("resolve_view_version — Me", () => {
  it("no groups: the plain own version, no group reads", async () => {
    get_user.mockResolvedValue({ data: { groupIds: [] } });
    expect(await me()).toBe(7);
    expect(get_many).not.toHaveBeenCalled();
  });

  it("in a group: a partner's bump moves the Me version", async () => {
    get_user.mockResolvedValue({ data: { groupIds: ["g1"] } });
    get_many.mockResolvedValue([grp("g1", ["alex", "sam"])]);
    const before = await me();
    expect(before).not.toBe(7);
    versions.sam = 4;
    expect(await me()).not.toBe(before);
  });

  it("stale groupIds (not actually a member) → plain own version", async () => {
    get_user.mockResolvedValue({ data: { groupIds: ["g1"] } });
    get_many.mockResolvedValue([grp("g1", ["sam"])]);
    expect(await me()).toBe(7);
  });
});
