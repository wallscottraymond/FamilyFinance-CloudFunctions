"use strict";
/**
 * Waitlist Resolver (Website-Waitlist) — read-only.
 *
 * @module resolvers/waitlist/waitlist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_join_waitlist_dependencies = resolve_join_waitlist_dependencies;
const dependency_1 = require("../../types/dependency");
/** A signup is standalone: nothing derived depends on it. */
function resolve_join_waitlist_dependencies(_ctx) {
    return (0, dependency_1.no_dependencies)();
}
//# sourceMappingURL=waitlist.resolver.js.map