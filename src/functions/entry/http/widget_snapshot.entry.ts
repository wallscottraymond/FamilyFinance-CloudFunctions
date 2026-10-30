/**
 * Widget Snapshot Entry Point ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * HTTPS GET called by the iOS widget extension on its own (no app, no Firebase SDK):
 *   GET /widget_snapshot?kind=left|summary|bills|budget_txns|recent&cadence=monthly&lookahead=7
 *       &budget=<id, budget_txns only>&group=<group id, optional>&have=<version>
 *   Authorization: Bearer <widget token>
 * → 200 { unchanged: true, version }      (widget already current; ~2 reads)
 * → 200 { version, data }                 (fresh widget data, schema v2)
 * → 200 { version, data: null }           (no current source period)
 * → 401 { error }                         (unknown / revoked token)
 * → 403 { error: "not_member" }            (group widget, caller no longer in that group)
 *
 * The token is read-only and scoped to widget data. Never logged.
 *
 * @module entry/http/widget_snapshot
 */

import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context } from "../../observability";
import {
  widget_snapshot_orchestrator,
} from "../../orchestrators/widgets/widget_snapshot.orchestrator";

const query_schema = z.object({
  kind: z.enum(["left", "summary", "bills", "budget_txns", "recent"]).default("left"),
  budget: z.string().min(1).max(128).optional(),
  group: z.string().trim().min(1).max(128).optional(),
  cadence: z.enum(["monthly", "weekly", "bi_monthly"]).default("monthly"),
  lookahead: z.coerce.number().int().optional(),
  have: z.coerce.number().int().nonnegative().optional(),
});

const BILLS_LOOKAHEADS = [7, 14, 30];

type WidgetQuery = z.infer<typeof query_schema> & { lookahead: number };

/** The widget's query, or null when invalid. The look-ahead only means something to Bills due
 *  soon (7 / 14 / 30 days); every other kind ignores it, so it never fails their request
 *  (Recent transactions sends 0: a strict check rejected every one of its requests). */
export function parse_widget_query(query: unknown): WidgetQuery | null {
  const parsed = query_schema.safeParse(query);
  if (!parsed.success) return null;
  const q = parsed.data;
  if (q.kind === "budget_txns" && !q.budget) return null;
  const lookahead = q.lookahead ?? 14;
  if (q.kind === "bills" && !BILLS_LOOKAHEADS.includes(lookahead)) return null;
  return { ...q, lookahead: q.kind === "bills" ? lookahead : 14 };
}

export const widget_snapshot = onRequest(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20, cors: false },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const auth = req.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (token.length < 32) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const query = parse_widget_query(req.query);
    if (!query) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }

    const ctx = create_trace_context(false);
    try {
      const outcome = await widget_snapshot_orchestrator(ctx, {
        token,
        kind: query.kind,
        budget_id: query.budget ?? null,
        group_id: query.group ?? null,
        cadence: query.cadence,
        lookahead_days: query.lookahead,
        have_version: query.have ?? null,
        now_ms: Date.now(),
      });
      res.set("Cache-Control", "no-store");
      switch (outcome.status) {
      case "unauthorized":
        res.status(401).json({ error: "unauthorized" });
        return;
      case "not_member":
        res.status(403).json({ error: "not_member" });
        return;
      case "unchanged":
        res.status(200).json({ unchanged: true, version: outcome.version });
        return;
      case "no_period":
        res.status(200).json({ version: outcome.version, data: null });
        return;
      case "data":
        res.status(200).json({ version: outcome.version, data: outcome.data });
        return;
      }
    } catch (error) {
      console.error(`[${ctx.trace_id}] widget_snapshot failed:`, error);
      res.status(500).json({ error: "internal", trace_id: ctx.trace_id });
    }
  }
);
