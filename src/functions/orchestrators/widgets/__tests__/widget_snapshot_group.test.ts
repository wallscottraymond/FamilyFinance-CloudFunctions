/**
 * widget_snapshot group views (Account-Rooted-Sharing): Edit Widget → Show picks a group.
 * Not a member → not_member (no data). A member → every derive gets the group scope, the
 * "unchanged" check uses the group view version, and the payload carries the group's name.
 * No group → the Me view version. Either way the widget's version also carries the UTC day
 * (Performance-Review-4 G11), so a widget refetches day-relative fields once a day.
 */
import { Timestamp } from "firebase-admin/firestore";

const derive_period = jest.fn();
const derive_goals = jest.fn();
const get_group = jest.fn();
const view_version = jest.fn();

jest.mock("../../../resolvers/widgets/widget.resolver", () => ({
  resolve_widget_request: jest.fn(async () => ({ user_id: "me" })),
  resolve_source_periods_from_now: jest.fn(async () => [
    {
      period_id: "2026M10",
      start_date: Timestamp.fromMillis(Date.UTC(2026, 9, 1)),
      end_date: Timestamp.fromMillis(Date.UTC(2026, 9, 31, 23, 59, 59)),
    },
  ]),
}));
jest.mock("../../periods/derive_period.orchestrator", () => ({
  derive_period_orchestrator: (...a: unknown[]) => derive_period(...a),
}));
jest.mock("../../goals/derive_goals_view.orchestrator", () => ({
  derive_goals_view_orchestrator: (...a: unknown[]) => derive_goals(...a),
}));
jest.mock("../../budgets/derive_budget_transactions.orchestrator", () => ({
  derive_budget_transactions_orchestrator: jest.fn(async () => []),
}));
jest.mock("../../../repositories/sharing", () => ({
  group_repo: { get: (...a: unknown[]) => get_group(...a) },
}));
jest.mock("../../../resolvers/periods/view_version.resolver", () => ({
  resolve_view_version: (...a: unknown[]) => view_version(...a),
}));

import { widget_snapshot_orchestrator } from "../widget_snapshot.orchestrator";
import { widget_view_version } from "../../../domain/periods/derive_scope.service";
import { create_trace_context } from "../../../observability";

const base = {
  token: "x".repeat(40),
  kind: "left" as const,
  budget_id: null,
  cadence: "monthly" as const,
  lookahead_days: 14,
  have_version: null,
  now_ms: Date.UTC(2026, 9, 7),
};
const derived = { budgets: [], bills: [], income: [] };
const grp = (ids: string[]) => ({
  id: "g1",
  name: "The Walls",
  deleted_at_ms: null,
  member_ids: ids,
  members: Object.fromEntries(ids.map((id) => [id, { role: "member" }])),
});

beforeEach(() => {
  jest.clearAllMocks();
  derive_period.mockResolvedValue(derived);
  derive_goals.mockResolvedValue({ periodId: "2026M10", goals: [], totalDrawThisPeriod: 0 });
  view_version.mockResolvedValue({ view_key: "group:g1", version: 42 });
});

describe("widget_snapshot group views", () => {
  it("Me (no group): Me view version, no scope, no groupName", async () => {
    view_version.mockResolvedValue({ view_key: "me", version: 5 });
    const out = await widget_snapshot_orchestrator(create_trace_context(false), { ...base, group_id: null });
    expect(out.status).toBe("data");
    expect(derive_period.mock.calls[0][2].scope).toBeUndefined();
    expect(get_group).not.toHaveBeenCalled();
    expect(view_version.mock.calls[0][2]).toBeUndefined();
    if (out.status === "data") {
      expect(out.version).toBe(widget_view_version(5, base.now_ms));
      expect("groupName" in out.data).toBe(false);
    }
  });

  it("not a member: not_member, nothing derived", async () => {
    get_group.mockResolvedValue(grp(["someone"]));
    const out = await widget_snapshot_orchestrator(create_trace_context(false), { ...base, group_id: "g1" });
    expect(out.status).toBe("not_member");
    expect(derive_period).not.toHaveBeenCalled();
  });

  it("missing group: not_member", async () => {
    get_group.mockResolvedValue(null);
    const out = await widget_snapshot_orchestrator(create_trace_context(false), { ...base, group_id: "gone" });
    expect(out.status).toBe("not_member");
  });

  it("member: group scope on derives, group version, groupName on the payload", async () => {
    get_group.mockResolvedValue(grp(["me", "sam"]));
    const out = await widget_snapshot_orchestrator(create_trace_context(false), {
      ...base,
      kind: "summary",
      group_id: "g1",
    });
    expect(out.status).toBe("data");
    expect(derive_period.mock.calls[0][2].scope).toEqual({ kind: "group", group_id: "g1" });
    expect(derive_goals.mock.calls[0][3]).toEqual({ kind: "group", group_id: "g1" });
    if (out.status === "data") {
      expect(out.version).toBe(widget_view_version(42, base.now_ms));
      expect(out.data.groupName).toBe("The Walls");
    }
  });

  it("member with the current group version: unchanged", async () => {
    get_group.mockResolvedValue(grp(["me"]));
    const out = await widget_snapshot_orchestrator(create_trace_context(false), {
      ...base,
      group_id: "g1",
      have_version: widget_view_version(42, base.now_ms),
    });
    expect(out).toEqual({ status: "unchanged", version: widget_view_version(42, base.now_ms) });
    expect(derive_period).not.toHaveBeenCalled();
  });

  it("same data version on a new UTC day: refetches (day-relative fields)", async () => {
    get_group.mockResolvedValue(grp(["me"]));
    const out = await widget_snapshot_orchestrator(create_trace_context(false), {
      ...base,
      group_id: "g1",
      have_version: widget_view_version(42, base.now_ms - 86_400_000),
    });
    expect(out.status).toBe("data");
  });
});
