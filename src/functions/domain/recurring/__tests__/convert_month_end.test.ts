/** AF-12: a schedule guessed on a month's last evening, from the caller's day. */
import { caller_day_ms } from "../../periods/caller_day.service";
import { guess_schedule } from "../convert_recurring.service";
import { compute_manual_next_due_date } from "../manual_outflow.service";

const D = (m: number, d: number) => Date.UTC(2026, m, d);
const payments = [D(6, 31), D(7, 31)]; // month-end payments, last paid Aug 31
const EVENING_UTC = Date.UTC(2026, 10, 1, 2); // 8 pm Mountain on Oct 31

it("the caller's day keeps a bill due tonight in this month", () => {
  const local = guess_schedule(payments, caller_day_ms("2026-10-31", EVENING_UTC));
  const utc = guess_schedule(payments, EVENING_UTC);
  expect(local?.next_due_ms).toBeDefined();
  expect(new Date(local!.next_due_ms).getUTCMonth()).toBe(9);
  expect(new Date(utc!.next_due_ms).getUTCMonth()).toBe(10);
});

it("a far-off or malformed day falls back to the server clock", () => {
  expect(caller_day_ms("2020-01-01", EVENING_UTC)).toBe(EVENING_UTC);
  expect(caller_day_ms("2026-13-45", EVENING_UTC)).toBe(EVENING_UTC);
  expect(caller_day_ms(undefined, EVENING_UTC)).toBe(EVENING_UTC);
});

it("a manual bill due on the 31st, added on the last evening, stays in this month", () => {
  const local = compute_manual_next_due_date("monthly", 31, caller_day_ms("2026-10-31", EVENING_UTC));
  expect(local.toISOString().slice(0, 10)).toBe("2026-10-31");
  const utc = compute_manual_next_due_date("monthly", 31, EVENING_UTC);
  expect(utc.toISOString().slice(0, 7)).toBe("2026-11");
});
