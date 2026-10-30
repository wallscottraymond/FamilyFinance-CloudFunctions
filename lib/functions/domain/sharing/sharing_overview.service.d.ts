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
import { Connection, Group, GroupRole, PersonView, SharingRequest } from "../../types/sharing.types";
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
    /** share_account: e.g. "Joint Checking ••1234". */
    account_label: string | null;
    /** share_account: shared from this instant; null = all history. */
    shared_from_ms: number | null;
    created_at_ms: number;
    expires_at_ms: number;
}
export interface SharingOverview {
    me: {
        user_id: string;
        generated_name: string;
    };
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
export declare function build_sharing_overview(viewer_id: string, connections: Connection[], groups: Group[], requests: SharingRequest[], request_groups: Record<string, Group>, now_ms: number): SharingOverview;
//# sourceMappingURL=sharing_overview.service.d.ts.map