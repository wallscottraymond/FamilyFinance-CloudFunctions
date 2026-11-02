/**
 * Code-Health-Review P2-M3: a repaired login's full refresh ran fire-and-forget INSIDE the 30 s
 * webhook (work after the reply is throttled / killed). The webhook now marks the item repaired
 * and QUEUES `refresh_repaired_item`; it never runs the refresh itself. Both job dispatchers
 * (immediate trigger + the sweep) must know the job type.
 */
import * as fs from "fs";
import * as path from "path";

const create_job = jest.fn(async () => "job1");
const refresh_repaired_item = jest.fn();
const mark_item_repaired = jest.fn(async () => undefined);
jest.mock("../../../infrastructure/job_queue", () => ({ create_job: (...a: unknown[]) => create_job(...(a as [])) }));
jest.mock("../reauth_recovery.orchestrator", () => ({
  mark_item_repaired: (...a: unknown[]) => mark_item_repaired(...(a as [])),
  refresh_repaired_item: (...a: unknown[]) => refresh_repaired_item(...a),
}));
jest.mock("../../../resolvers/plaid/item_status_webhook.resolver", () => ({
  resolve_item_status_webhook_dependencies: jest.fn(async () => ({
    item_found: true, item_doc_id: "doc1", user_id: "u1", current_status: "item_login_required",
    institution_name: "Bank",
  })),
}));

import { handle_login_repaired_orchestrator } from "../handle_login_repaired.orchestrator";

it("marks the item repaired and queues the refresh (never runs it in the webhook)", async () => {
  const out = await handle_login_repaired_orchestrator({
    trace_id: "t", span_id: "s", user_id: "system", idempotency_key: "k",
    input: { plaid_item_id: "pi1" },
  } as never);
  expect(mark_item_repaired).toHaveBeenCalled();
  expect(refresh_repaired_item).not.toHaveBeenCalled();
  expect(create_job).toHaveBeenCalledWith(
    "refresh_repaired_item",
    expect.objectContaining({ item_doc_id: "doc1", plaid_item_id: "pi1", user_id: "u1" }),
    expect.anything()
  );
  expect(out).toMatchObject({ success: true });
});

it("both job dispatchers handle refresh_repaired_item (and agree on every job type)", () => {
  const keys = (rel: string): string[] => {
    const src = fs.readFileSync(path.join(__dirname, "../../../", rel), "utf8");
    const block = src.slice(src.indexOf("const JOB_HANDLERS"), src.indexOf("\n};", src.indexOf("const JOB_HANDLERS")));
    return [...block.matchAll(/^ {2}([a-z_]+): async/gm)].map((m) => m[1]).sort();
  };
  const trigger = keys("entry/triggers/on_job_created.trigger.ts");
  const sweep = keys("entry/scheduled/process_job_queue.scheduled.ts");
  expect(trigger).toContain("refresh_repaired_item");
  expect(sweep).toEqual(trigger);
});
