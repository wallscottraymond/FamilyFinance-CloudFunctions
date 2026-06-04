"use strict";
/**
 * Audit Trail Module
 *
 * Provides immutable audit logging for all repository writes.
 * Audit entries are append-only and NEVER deleted.
 *
 * @module audit
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.has_audit_history = exports.get_latest_audit_entry = exports.get_entity_audit_history = exports.query_audit_entries = exports.record_audit_entries_batch = exports.record_audit_entry_async = exports.record_audit_entry = void 0;
// Writer functions
var audit_writer_1 = require("./audit_writer");
Object.defineProperty(exports, "record_audit_entry", { enumerable: true, get: function () { return audit_writer_1.record_audit_entry; } });
Object.defineProperty(exports, "record_audit_entry_async", { enumerable: true, get: function () { return audit_writer_1.record_audit_entry_async; } });
Object.defineProperty(exports, "record_audit_entries_batch", { enumerable: true, get: function () { return audit_writer_1.record_audit_entries_batch; } });
Object.defineProperty(exports, "query_audit_entries", { enumerable: true, get: function () { return audit_writer_1.query_audit_entries; } });
Object.defineProperty(exports, "get_entity_audit_history", { enumerable: true, get: function () { return audit_writer_1.get_entity_audit_history; } });
Object.defineProperty(exports, "get_latest_audit_entry", { enumerable: true, get: function () { return audit_writer_1.get_latest_audit_entry; } });
Object.defineProperty(exports, "has_audit_history", { enumerable: true, get: function () { return audit_writer_1.has_audit_history; } });
//# sourceMappingURL=index.js.map