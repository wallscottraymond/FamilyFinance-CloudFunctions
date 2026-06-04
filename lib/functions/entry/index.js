"use strict";
/**
 * Entry Layer
 *
 * Cloud Function entry points that translate external requests
 * into internal system calls.
 *
 * @module entry
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_relink_attempts_scheduled = exports.retry_transient_plaid_errors_scheduled = exports.process_job_queue = void 0;
// Callable functions (user-initiated via httpsCallable)
__exportStar(require("./callable"), exports);
// HTTP functions (webhook endpoints)
__exportStar(require("./http"), exports);
// Firestore triggers (document-change initiated)
__exportStar(require("./triggers"), exports);
// Scheduled fallback worker for the job queue (retries failed/missed jobs every
// minute; on_job_created handles the immediate path). Only the queue worker is
// wired here — the other scheduled functions in ./scheduled (log/idempotency
// cleanup, soft-delete purge, quota snapshots) are intentionally left
// un-deployed pending a deliberate decision, since some have destructive
// side effects.
var process_job_queue_scheduled_1 = require("./scheduled/process_job_queue.scheduled");
Object.defineProperty(exports, "process_job_queue", { enumerable: true, get: function () { return process_job_queue_scheduled_1.process_job_queue; } });
// Plaid transient-error auto-retry: silently re-syncs items that are down /
// rate limited every 4h, surfacing a reconnect prompt only after 24h. Safe to
// deploy — reads + targeted item updates, no destructive side effects.
var retry_transient_plaid_errors_scheduled_1 = require("./scheduled/retry_transient_plaid_errors.scheduled");
Object.defineProperty(exports, "retry_transient_plaid_errors_scheduled", { enumerable: true, get: function () { return retry_transient_plaid_errors_scheduled_1.retry_transient_plaid_errors_scheduled; } });
// Plaid relink-attempt retention cleanup (daily; safe — deletes only records
// older than 30 days).
var cleanup_relink_attempts_scheduled_1 = require("./scheduled/cleanup_relink_attempts.scheduled");
Object.defineProperty(exports, "cleanup_relink_attempts_scheduled", { enumerable: true, get: function () { return cleanup_relink_attempts_scheduled_1.cleanup_relink_attempts_scheduled; } });
//# sourceMappingURL=index.js.map