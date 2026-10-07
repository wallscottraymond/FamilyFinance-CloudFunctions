/**
 * enter_connect_code: two people typing each other's codes at the same moment. Each reads before
 * the other's entry lands, so the first read says "waiting" for both. The re-check after writing
 * must connect (once, without overwriting), so nobody has to tap Connect twice.
 */
const get_by_user = jest.fn();
const record_entry = jest.fn();
const expire_codes = jest.fn();
const create_if_absent = jest.fn();
const resolve_code_entry = jest.fn();

jest.mock("../../../repositories/sharing", () => ({
  connect_code_repo: {
    get_by_user: (...a: unknown[]) => get_by_user(...a),
    record_entry: (...a: unknown[]) => record_entry(...a),
    expire_codes: (...a: unknown[]) => expire_codes(...a),
    set_failure_state: jest.fn(),
  },
  connection_repo: { create_if_absent: (...a: unknown[]) => create_if_absent(...a) },
}));
jest.mock("../../../resolvers/sharing/sharing.resolver", () => ({
  resolve_code_entry: (...a: unknown[]) => resolve_code_entry(...a),
  resolve_my_code: jest.fn(),
  resolve_code_taken: jest.fn(),
}));

import { enter_connect_code_orchestrator } from "../connect.orchestrator";
import { create_trace_context } from "../../../observability";

const NOW = Date.now();
const code_doc = (user_id: string, code: string, entries: Record<string, number> = {}) => ({
  user_id,
  code,
  expires_at_ms: NOW + 5 * 60 * 1000,
  entries,
  failed_attempts: 0,
  cooldown_until_ms: 0,
});
const ctx = (user_id: string, code: string) => ({
  ...create_trace_context(),
  input: { code },
  user_id,
  idempotency_key: "k",
});

beforeEach(() => {
  jest.clearAllMocks();
  // Bea is typing Al's code; her own code doc had no entries when the resolver read it.
  resolve_code_entry.mockResolvedValue({
    caller_code: code_doc("bea", "BBBBBB"),
    target: code_doc("al", "AAAAAA"),
    existing_connection: null,
    caller_connection_count: 0,
    target_connection_count: 0,
  });
});

it("connects when the other person's entry lands between the read and the write", async () => {
  get_by_user.mockResolvedValue(code_doc("bea", "BBBBBB", { al: NOW - 500 }));
  const res = await enter_connect_code_orchestrator(ctx("bea", "AAAAAA"));
  expect(res.outcome).toBe("connected");
  expect(record_entry).toHaveBeenCalledWith(expect.anything(), "al", "bea", expect.any(Number));
  expect(create_if_absent).toHaveBeenCalledTimes(1);
  expect(create_if_absent.mock.calls[0][1]).toMatchObject({ user_ids: ["al", "bea"], status: "connected" });
  expect(expire_codes).toHaveBeenCalledWith(expect.anything(), ["bea", "al"], expect.any(Number));
});

it("still waits when the other person hasn't typed yet", async () => {
  get_by_user.mockResolvedValue(code_doc("bea", "BBBBBB"));
  const res = await enter_connect_code_orchestrator(ctx("bea", "AAAAAA"));
  expect(res.outcome).toBe("waiting");
  expect(res.person?.user_id).toBe("al");
  expect(create_if_absent).not.toHaveBeenCalled();
  expect(expire_codes).not.toHaveBeenCalled();
});

it("waits (and lets the overview poll finish it) when the other side already connected and cleared the codes", async () => {
  get_by_user.mockResolvedValue({ ...code_doc("bea", "BBBBBB"), expires_at_ms: NOW - 1 });
  const res = await enter_connect_code_orchestrator(ctx("bea", "AAAAAA"));
  expect(res.outcome).toBe("waiting");
  expect(create_if_absent).not.toHaveBeenCalled();
});

it("connects on the first read without a second look when the entry was already there", async () => {
  resolve_code_entry.mockResolvedValue({
    caller_code: code_doc("bea", "BBBBBB", { al: NOW - 500 }),
    target: code_doc("al", "AAAAAA"),
    existing_connection: null,
    caller_connection_count: 0,
    target_connection_count: 0,
  });
  const res = await enter_connect_code_orchestrator(ctx("bea", "AAAAAA"));
  expect(res.outcome).toBe("connected");
  expect(get_by_user).not.toHaveBeenCalled();
  expect(record_entry).not.toHaveBeenCalled();
  expect(create_if_absent).toHaveBeenCalledTimes(1);
});
