"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.caller_day_ms = caller_day_ms;
/**
 * The instant a request's "today" is chosen at: noon UTC of the caller's LOCAL calendar day (`day`),
 * so its UTC day index IS that local day. On a US evening the server's UTC clock is already
 * tomorrow, which flipped a widget to the next period on a period's last evening (batch 6 verify #3)
 * and skipped a bill due that evening to next month (AF-12). Accepted only within a day of the
 * server's UTC day (every real time zone is); otherwise, or absent (older builds), the server clock.
 *
 * PURE. @module domain/periods/caller_day
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function caller_day_ms(day, now_ms) {
    if (!day)
        return now_ms;
    const [y, m, d] = day.split("-").map(Number);
    const day_start = Date.UTC(y, m - 1, d);
    const check = new Date(day_start);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
        return now_ms;
    }
    const diff = Math.floor(day_start / DAY_MS) - Math.floor(now_ms / DAY_MS);
    return Math.abs(diff) <= 1 ? day_start + DAY_MS / 2 : now_ms;
}
//# sourceMappingURL=caller_day.service.js.map