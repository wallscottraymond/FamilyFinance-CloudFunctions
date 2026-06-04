"use strict";
/**
 * Observability Module
 *
 * Provides tracing and logging infrastructure for the layered architecture.
 *
 * @module observability
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.log_trace_summary = exports.log_debug_if_enabled = exports.log_deferred_to_background = exports.log_idempotent_return = exports.log_operation_error = exports.log_operation_success = exports.log_operation_start = exports.log_async_debug = exports.log_minimal = exports.fire_and_forget = exports.create_trigger_trace = exports.extract_trace_from_request = exports.should_log_tier2 = exports.get_span_duration = exports.create_span = exports.create_child_span = exports.create_trace_context = exports.generate_id = void 0;
// Tracer exports
var tracer_1 = require("./tracer");
Object.defineProperty(exports, "generate_id", { enumerable: true, get: function () { return tracer_1.generate_id; } });
Object.defineProperty(exports, "create_trace_context", { enumerable: true, get: function () { return tracer_1.create_trace_context; } });
Object.defineProperty(exports, "create_child_span", { enumerable: true, get: function () { return tracer_1.create_child_span; } });
Object.defineProperty(exports, "create_span", { enumerable: true, get: function () { return tracer_1.create_span; } });
Object.defineProperty(exports, "get_span_duration", { enumerable: true, get: function () { return tracer_1.get_span_duration; } });
Object.defineProperty(exports, "should_log_tier2", { enumerable: true, get: function () { return tracer_1.should_log_tier2; } });
Object.defineProperty(exports, "extract_trace_from_request", { enumerable: true, get: function () { return tracer_1.extract_trace_from_request; } });
Object.defineProperty(exports, "create_trigger_trace", { enumerable: true, get: function () { return tracer_1.create_trigger_trace; } });
// Logger exports
var logger_1 = require("./logger");
Object.defineProperty(exports, "fire_and_forget", { enumerable: true, get: function () { return logger_1.fire_and_forget; } });
Object.defineProperty(exports, "log_minimal", { enumerable: true, get: function () { return logger_1.log_minimal; } });
Object.defineProperty(exports, "log_async_debug", { enumerable: true, get: function () { return logger_1.log_async_debug; } });
Object.defineProperty(exports, "log_operation_start", { enumerable: true, get: function () { return logger_1.log_operation_start; } });
Object.defineProperty(exports, "log_operation_success", { enumerable: true, get: function () { return logger_1.log_operation_success; } });
Object.defineProperty(exports, "log_operation_error", { enumerable: true, get: function () { return logger_1.log_operation_error; } });
Object.defineProperty(exports, "log_idempotent_return", { enumerable: true, get: function () { return logger_1.log_idempotent_return; } });
Object.defineProperty(exports, "log_deferred_to_background", { enumerable: true, get: function () { return logger_1.log_deferred_to_background; } });
Object.defineProperty(exports, "log_debug_if_enabled", { enumerable: true, get: function () { return logger_1.log_debug_if_enabled; } });
Object.defineProperty(exports, "log_trace_summary", { enumerable: true, get: function () { return logger_1.log_trace_summary; } });
//# sourceMappingURL=index.js.map