/**
 * Join Waitlist Entry Point (Website-Waitlist)
 *
 * POST /api/waitlist on budg.io (Firebase Hosting rewrite, so same-origin and no CORS).
 *   { email, source?: "hero" | "footer", company?: honeypot }
 * → 200 { ok: true }              (joined, already on the list, or honeypot: all look the same)
 * → 400 { error: "invalid_email" }
 * → 405 { error: "method_not_allowed" }
 * → 429 { error: "rate_limited" }
 *
 * Public and unauthenticated by design: the site has no sign-in. Emails and addresses are never
 * logged.
 *
 * @module entry/http/join_waitlist
 */

import { onRequest } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { client_ip } from "../../domain/waitlist/waitlist.service";
import {
  join_waitlist_orchestrator,
} from "../../orchestrators/waitlist/join_waitlist.orchestrator";
import { join_waitlist_input_schema } from "../../types/waitlist.types";

export const join_waitlist = onRequest(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 5, cors: false, invoker: "public" },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const validation = join_waitlist_input_schema.safeParse(req.body ?? {});
    if (!validation.success) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }

    const ctx = create_trace_context(false);
    try {
      const status = await join_waitlist_orchestrator(
        ctx,
        validation.data,
        client_ip(req.get("fastly-client-ip"), req.get("x-forwarded-for"), req.ip)
      );
      if (status === "rate_limited") {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.error(`[${ctx.trace_id}] join_waitlist failed:`, message);
      res.status(500).json({ error: "internal", trace_id: ctx.trace_id });
    }
  }
);
