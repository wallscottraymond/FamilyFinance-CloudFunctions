/**
 * Code-Health-Review P2-M1: pull-to-refresh did nothing — the resolver queried
 * `status == "active"` (a value no writer sets) and decrypted `encryptedAccessToken` (a field
 * that doesn't exist), and rate-limited on `lastSyncAt` (never written). It must select the user's
 * ACTIVE items (any status), decrypt the stored `accessToken`, and rate-limit on `lastSyncedAt`.
 */
import { Timestamp } from "firebase-admin/firestore";

const get_by_user_id = jest.fn();
jest.mock("../../../repositories/plaid", () => ({
  plaid_item_repo: { get_by_user_id: (...a: unknown[]) => get_by_user_id(...a) },
}));
jest.mock("../../../../utils/encryption", () => ({
  decryptAccessToken: (enc: string) => `plain:${enc}`,
}));
jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");
  return {
    ...actual,
    getFirestore: () => ({
      collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ currency: "USD" }) }) }) }),
    }),
  };
});

import { resolve_refresh_dependencies } from "../refresh_plaid_data.resolver";

const ctx = { trace_id: "t", span_id: "s" };
const item = (over: Record<string, unknown>) => ({
  id: "doc1", plaid_item_id: "item1", user_id: "u", institution_name: "Bank",
  access_token: "enc1", status: "good", is_active: true, last_synced_at: null, ...over,
});

describe("resolve_refresh_dependencies (P2-M1)", () => {
  beforeEach(() => get_by_user_id.mockReset());

  it("selects the user's active items whatever their status, with the decrypted stored token", async () => {
    get_by_user_id.mockResolvedValue([item({}), item({ id: "doc2", plaid_item_id: "item2", status: "item_login_required", access_token: "enc2" })]);
    const deps = await resolve_refresh_dependencies(ctx, { user_id: "u" } as never);
    expect(get_by_user_id).toHaveBeenCalledWith(ctx, "u");
    expect(deps!.items.map((i) => [i.item_id, i.doc_id, i.access_token])).toEqual([
      ["item1", "doc1", "plain:enc1"],
      ["item2", "doc2", "plain:enc2"],
    ]);
  });

  it("one item when item_id is given; none → null", async () => {
    get_by_user_id.mockResolvedValue([item({}), item({ id: "doc2", plaid_item_id: "item2" })]);
    const deps = await resolve_refresh_dependencies(ctx, { user_id: "u", item_id: "item2" } as never);
    expect(deps!.items.map((i) => i.item_id)).toEqual(["item2"]);
    get_by_user_id.mockResolvedValue([]);
    expect(await resolve_refresh_dependencies(ctx, { user_id: "u" } as never)).toBeNull();
  });

  it("rate-limits on lastSyncedAt (synced 1 min ago → skipped; 10 min ago → synced)", async () => {
    const ago = (s: number) => Timestamp.fromMillis(Date.now() - s * 1000);
    get_by_user_id.mockResolvedValue([
      item({ last_synced_at: ago(60) }),
      item({ id: "doc2", plaid_item_id: "item2", last_synced_at: ago(600) }),
    ]);
    const deps = await resolve_refresh_dependencies(ctx, { user_id: "u" } as never);
    expect(deps!.rate_limited_items).toEqual(["item1"]);
    expect(deps!.items.map((i) => i.item_id)).toEqual(["item2"]);
  });

  it("an item without a token is skipped, not fatal", async () => {
    get_by_user_id.mockResolvedValue([item({ access_token: undefined }), item({ id: "doc2", plaid_item_id: "item2" })]);
    const deps = await resolve_refresh_dependencies(ctx, { user_id: "u" } as never);
    expect(deps!.items.map((i) => i.item_id)).toEqual(["item2"]);
  });
});
