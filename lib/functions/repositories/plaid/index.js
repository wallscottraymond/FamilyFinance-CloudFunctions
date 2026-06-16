"use strict";
/**
 * Plaid Repositories Index
 *
 * Re-exports all Plaid-related repositories.
 *
 * @module repositories/plaid
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_webhook_repo = exports.relink_attempt_repo = exports.plaid_item_repo = exports.link_token_event_repo = void 0;
var link_token_event_repo_1 = require("./link_token_event.repo");
Object.defineProperty(exports, "link_token_event_repo", { enumerable: true, get: function () { return link_token_event_repo_1.link_token_event_repo; } });
var plaid_item_repo_1 = require("./plaid_item.repo");
Object.defineProperty(exports, "plaid_item_repo", { enumerable: true, get: function () { return plaid_item_repo_1.plaid_item_repo; } });
var relink_attempt_repo_1 = require("./relink_attempt.repo");
Object.defineProperty(exports, "relink_attempt_repo", { enumerable: true, get: function () { return relink_attempt_repo_1.relink_attempt_repo; } });
var plaid_webhook_repo_1 = require("./plaid_webhook.repo");
Object.defineProperty(exports, "plaid_webhook_repo", { enumerable: true, get: function () { return plaid_webhook_repo_1.plaid_webhook_repo; } });
//# sourceMappingURL=index.js.map