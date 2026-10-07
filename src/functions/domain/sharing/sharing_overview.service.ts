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

import {
  Connection,
  Group,
  GroupRole,
  PersonView,
  SharingRequest,
} from "../../types/sharing.types";
import { generated_name, person_view } from "./names.service";
import { other_user } from "./connection.service";
import { is_open } from "./request.service";
import { MAX_CONNECTIONS } from "./connect_code.service";
import { MAX_GROUPS_PER_USER } from "./group.service";

export interface OverviewConnection {
  person: PersonView;
  connected_at_ms: number;
  /** Names of the viewer's groups this person is also in. */
  shared_group_names: string[];
}

export interface OverviewGroupMember {
  person: PersonView;
  role: GroupRole;
  is_me: boolean;
}

export interface OverviewGroup {
  id: string;
  name: string;
  my_role: GroupRole;
  members: OverviewGroupMember[];
}

export interface OverviewRequest {
  id: string;
  type: SharingRequest["type"];
  from: PersonView;
  group_id: string;
  group_name: string;
  group_member_count: number;
  created_at_ms: number;
  expires_at_ms: number;
}

export interface SharingOverview {
  me: { user_id: string; generated_name: string };
  connections: OverviewConnection[];
  connection_limit: number;
  groups: OverviewGroup[];
  group_limit: number;
  requests: OverviewRequest[];
}

/**
 * Builds the overview for `viewer_id`.
 *
 * @param connections - the viewer's connection docs (blocked ones are left out)
 * @param groups - the viewer's active groups
 * @param requests - requests addressed to the viewer
 * @param request_groups - group docs referenced by those requests (by id)
 */
export function build_sharing_overview(
  viewer_id: string,
  connections: Connection[],
  groups: Group[],
  requests: SharingRequest[],
  request_groups: Record<string, Group>,
  now_ms: number
): SharingOverview {
  const connected = connections.filter((c) => c.status === "connected");
  const nicknames: Record<string, string> = {};
  for (const c of connected) {
    const nick = c.nicknames[viewer_id];
    if (nick) nicknames[other_user(c, viewer_id)] = nick;
  }
  const view = (uid: string): PersonView => person_view(uid, nicknames);

  const active_groups = groups
    .filter((g) => g.deleted_at_ms === null && g.members[viewer_id])
    .sort((a, b) => a.created_at_ms - b.created_at_ms);

  const out_groups: OverviewGroup[] = active_groups.map((g) => ({
    id: g.id,
    name: g.name,
    my_role: g.members[viewer_id].role,
    members: [...g.member_ids]
      .sort((a, b) => g.members[a].joined_at_ms - g.members[b].joined_at_ms)
      .map((uid) => ({ person: view(uid), role: g.members[uid].role, is_me: uid === viewer_id })),
  }));

  const out_connections: OverviewConnection[] = connected
    .map((c) => {
      const other = other_user(c, viewer_id);
      return {
        person: view(other),
        connected_at_ms: c.connected_at_ms,
        shared_group_names: active_groups.filter((g) => g.members[other]).map((g) => g.name),
      };
    })
    .sort((a, b) => b.connected_at_ms - a.connected_at_ms);

  const out_requests: OverviewRequest[] = requests
    .filter((r) => r.to_user_id === viewer_id && is_open(r, now_ms))
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
        created_at_ms: r.created_at_ms,
        expires_at_ms: r.expires_at_ms,
      };
    });

  return {
    me: { user_id: viewer_id, generated_name: generated_name(viewer_id) },
    connections: out_connections,
    connection_limit: MAX_CONNECTIONS,
    groups: out_groups,
    group_limit: MAX_GROUPS_PER_USER,
    requests: out_requests,
  };
}
