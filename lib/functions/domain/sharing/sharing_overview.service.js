"use strict";
/**
 * Sharing Overview (Groups screen read model)
 *
 * Shapes connections, groups and incoming requests into what the Groups screen
 * shows, with every person rendered per the viewer (D28: generated name +
 * the viewer's own nickname; never an email).
 *
 * PURE: no IO.
 *
 * @module domain/sharing/sharing_overview
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_sharing_overview = build_sharing_overview;
const names_service_1 = require("./names.service");
const connection_service_1 = require("./connection.service");
const request_service_1 = require("./request.service");
const connect_code_service_1 = require("./connect_code.service");
const group_service_1 = require("./group.service");
/**
 * Builds the overview for `viewer_id`.
 *
 * @param connections - the viewer's connection docs (blocked ones are left out)
 * @param groups - the viewer's active groups
 * @param requests - requests addressed to the viewer
 * @param request_groups - group docs referenced by those requests (by id)
 */
function build_sharing_overview(viewer_id, connections, groups, requests, request_groups, now_ms) {
    const connected = connections.filter((c) => c.status === "connected");
    const nicknames = {};
    for (const c of connected) {
        const nick = c.nicknames[viewer_id];
        if (nick)
            nicknames[(0, connection_service_1.other_user)(c, viewer_id)] = nick;
    }
    const view = (uid) => (0, names_service_1.person_view)(uid, nicknames);
    const active_groups = groups
        .filter((g) => g.deleted_at_ms === null && g.members[viewer_id])
        .sort((a, b) => a.created_at_ms - b.created_at_ms);
    const out_groups = active_groups.map((g) => ({
        id: g.id,
        name: g.name,
        my_role: g.members[viewer_id].role,
        members: [...g.member_ids]
            .sort((a, b) => g.members[a].joined_at_ms - g.members[b].joined_at_ms)
            .map((uid) => ({ person: view(uid), role: g.members[uid].role, is_me: uid === viewer_id })),
    }));
    const out_connections = connected
        .map((c) => {
        const other = (0, connection_service_1.other_user)(c, viewer_id);
        return {
            person: view(other),
            connected_at_ms: c.connected_at_ms,
            shared_group_names: active_groups.filter((g) => g.members[other]).map((g) => g.name),
        };
    })
        .sort((a, b) => b.connected_at_ms - a.connected_at_ms);
    const out_requests = requests
        .filter((r) => r.to_user_id === viewer_id && (0, request_service_1.is_open)(r, now_ms))
        .filter((r) => {
        const g = request_groups[r.group_id];
        return !!g && g.deleted_at_ms === null;
    })
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .map((r) => {
        const g = request_groups[r.group_id];
        return {
            id: r.id,
            type: r.type,
            from: view(r.from_user_id),
            group_id: r.group_id,
            group_name: g.name,
            group_member_count: g.member_ids.length,
            account_label: r.target_label,
            shared_from_ms: r.shared_from_ms,
            created_at_ms: r.created_at_ms,
            expires_at_ms: r.expires_at_ms,
        };
    });
    return {
        me: { user_id: viewer_id, generated_name: (0, names_service_1.generated_name)(viewer_id) },
        connections: out_connections,
        connection_limit: connect_code_service_1.MAX_CONNECTIONS,
        groups: out_groups,
        group_limit: group_service_1.MAX_GROUPS_PER_USER,
        requests: out_requests,
    };
}
//# sourceMappingURL=sharing_overview.service.js.map