"use strict";
/**
 * Waitlist types (Website-Waitlist).
 *
 * @module types/waitlist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.join_waitlist_input_schema = exports.LIMIT_RETENTION_MS = exports.MAX_NEW_SIGNUPS_PER_DAY = exports.MAX_ATTEMPTS_PER_IP_PER_DAY = void 0;
const zod_1 = require("zod");
/** Requests one network may make per UTC day (new signups and repeats alike). */
exports.MAX_ATTEMPTS_PER_IP_PER_DAY = 10;
/** New signups accepted per UTC day: the ceiling on writes if the network limit is dodged. */
exports.MAX_NEW_SIGNUPS_PER_DAY = 1000;
/** How long a per-network counter lives: past its own day, then TTL removes it. */
exports.LIMIT_RETENTION_MS = 2 * 86400000;
exports.join_waitlist_input_schema = zod_1.z.object({
    email: zod_1.z.string().trim().toLowerCase().max(254).email(),
    /** Which form was used: a fixed list, so nothing free-form is stored. */
    source: zod_1.z.enum(["hero", "footer"]).default("hero"),
    /** Honeypot: hidden from people, so a value here means a bot. */
    company: zod_1.z.string().max(500).optional(),
});
//# sourceMappingURL=waitlist.types.js.map