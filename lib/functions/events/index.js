"use strict";
/**
 * Events Module
 *
 * Domain event emission for observability and trigger activation.
 *
 * @module events
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountEvents = exports.PLAID_EVENTS = exports.ACCOUNT_EVENTS = exports.create_event_emitter = exports.emit_domain_event = void 0;
var domain_events_1 = require("./domain_events");
Object.defineProperty(exports, "emit_domain_event", { enumerable: true, get: function () { return domain_events_1.emit_domain_event; } });
Object.defineProperty(exports, "create_event_emitter", { enumerable: true, get: function () { return domain_events_1.create_event_emitter; } });
Object.defineProperty(exports, "ACCOUNT_EVENTS", { enumerable: true, get: function () { return domain_events_1.ACCOUNT_EVENTS; } });
Object.defineProperty(exports, "PLAID_EVENTS", { enumerable: true, get: function () { return domain_events_1.PLAID_EVENTS; } });
// Typed event emission helpers
var account_events_1 = require("./account.events");
Object.defineProperty(exports, "AccountEvents", { enumerable: true, get: function () { return account_events_1.ACCOUNT_EVENTS; } });
//# sourceMappingURL=index.js.map