/**
 * Emulator Integration Tests — Plaid Relink / Transient-Error Auto-Retry
 *
 * Exercises the item-status webhook handlers and the silent auto-retry job
 * directly against the Firestore emulator (no functions emulator). Covers:
 *   1. handle_item_error  → transient errors classify to a SILENT status +
 *                           anchor transientSince; reauth errors surface.
 *   2. retry orchestrator → escalates after the 24h window, keeps waiting
 *                           within it (the balance-sync probe fails under
 *                           --only firestore, i.e. "still down").
 *   3. handle_login_repaired → clears the error + the transient anchor.
 *
 * Prereqs: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import { handle_item_error_orchestrator } from '../src/functions/orchestrators/plaid/handle_item_error.orchestrator';
import { handle_login_repaired_orchestrator } from '../src/functions/orchestrators/plaid/handle_login_repaired.orchestrator';
import { retry_transient_item_errors_orchestrator } from '../src/functions/orchestrators/plaid/retry_transient_item_errors.orchestrator';

const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const pid = () => `plaiditem_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const webhookCtx = (plaidItemId: string) => ({
  trace_id: `t_${Date.now()}`,
  span_id: `s_${Date.now()}`,
  input: {
    plaid_item_id: plaidItemId,
    webhook_type: 'ITEM',
    webhook_code: 'ERROR',
  },
  user_id: 'webhook',
  idempotency_key: `k_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
});
const schedCtx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });

/* eslint-disable @typescript-eslint/naming-convention */
async function seedItem(
  docId: string,
  plaidItemId: string,
  userId: string,
  fields: Record<string, unknown> = {}
) {
  await db.collection('plaid_items').doc(docId).set({
    id: docId,
    plaidItemId,
    userId,
    groupIds: [],
    institutionId: 'ins_1',
    institutionName: 'Test Bank',
    accessToken: 'encrypted_placeholder',
    status: 'good',
    error: null,
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...fields,
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const getItem = async (docId: string) =>
  (await db.collection('plaid_items').doc(docId).get()).data();

// The auto-retry resolver scans ALL transient items globally and probes each
// (a real balance sync). Clear the collection so a retry pass processes exactly
// the one item under test — deterministic counts + fast (no probing leftovers).
async function clearItems() {
  const snap = await db.collection('plaid_items').get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

describe('Plaid relink — item status webhooks (emulator)', () => {
  afterAll(async () => {
    await db.terminate();
  });

  describe('handle_item_error', () => {
    it('classifies a transient error as a silent temporary_error + anchors transientSince', async () => {
      const userId = uid();
      const plaidItemId = pid();
      const docId = `doc_${plaidItemId}`;
      await seedItem(docId, plaidItemId, userId);

      const ctx = webhookCtx(plaidItemId);
      ctx.input = {
        ...ctx.input,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        error: {
          error_type: 'INSTITUTION_ERROR',
          error_code: 'INSTITUTION_DOWN',
          error_message: 'The institution is down',
          display_message: null,
        },
      } as typeof ctx.input;

      await handle_item_error_orchestrator(ctx);

      const item = await getItem(docId);
      expect(item?.status).toBe('temporary_error');
      expect(item?.requiresReauth).toBe(false);
      expect(item?.error).toBe('INSTITUTION_DOWN');
      expect(item?.transientSince).toBeTruthy(); // anchor set
    });

    it('surfaces a reauth error immediately (item_login_required, requiresReauth)', async () => {
      const userId = uid();
      const plaidItemId = pid();
      const docId = `doc_${plaidItemId}`;
      await seedItem(docId, plaidItemId, userId);

      const ctx = webhookCtx(plaidItemId);
      ctx.input = {
        ...ctx.input,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        error: {
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
          error_message: 'Login required',
          display_message: null,
        },
      } as typeof ctx.input;

      await handle_item_error_orchestrator(ctx);

      const item = await getItem(docId);
      expect(item?.status).toBe('item_login_required');
      expect(item?.requiresReauth).toBe(true);
    });
  });

  describe('retry_transient_item_errors (auto-retry)', () => {
    it('escalates a transient item that has been failing past the 24h window', async () => {
      await clearItems();
      const userId = uid();
      const plaidItemId = pid();
      const docId = `doc_${plaidItemId}`;
      // Transient since 25h ago → past the surface threshold. The balance-sync
      // probe fails under --only firestore (no Plaid), i.e. "still down".
      await seedItem(docId, plaidItemId, userId, {
        status: 'temporary_error',
        error: 'INSTITUTION_DOWN',
        requiresReauth: false,
        transientSince: Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000),
      });

      const res = await retry_transient_item_errors_orchestrator(schedCtx());
      expect(res.processed).toBe(1);
      expect(res.escalated).toBe(1);

      const item = await getItem(docId);
      expect(item?.status).toBe('item_login_required');
      expect(item?.requiresReauth).toBe(true);
      expect(item?.transientSince).toBeNull();
    });

    it('keeps a recently-failed transient item silent (still_waiting)', async () => {
      await clearItems();
      const userId = uid();
      const plaidItemId = pid();
      const docId = `doc_${plaidItemId}`;
      await seedItem(docId, plaidItemId, userId, {
        status: 'rate_limited',
        error: 'RATE_LIMIT_EXCEEDED',
        requiresReauth: false,
        transientSince: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000), // 1h ago
      });

      const res = await retry_transient_item_errors_orchestrator(schedCtx());
      expect(res.processed).toBe(1);
      expect(res.still_waiting).toBe(1);

      const item = await getItem(docId);
      expect(item?.status).toBe('rate_limited'); // still silent
      expect(item?.requiresReauth).not.toBe(true);
      expect(item?.retryCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('handle_login_repaired', () => {
    it('clears the error state and the transient anchor', async () => {
      const userId = uid();
      const plaidItemId = pid();
      const docId = `doc_${plaidItemId}`;
      await seedItem(docId, plaidItemId, userId, {
        status: 'item_login_required',
        error: 'ITEM_LOGIN_REQUIRED',
        errorMessage: 'Login required',
        requiresReauth: true,
        transientSince: Timestamp.fromMillis(Date.now() - 5 * 60 * 60 * 1000),
      });

      await handle_login_repaired_orchestrator({
        trace_id: `t_${Date.now()}`,
        span_id: `s_${Date.now()}`,
        input: {
          plaid_item_id: plaidItemId,
          webhook_type: 'ITEM',
          webhook_code: 'LOGIN_REPAIRED',
        },
        user_id: 'webhook',
        idempotency_key: `k_${Date.now()}`,
      });

      const item = await getItem(docId);
      expect(item?.status).toBe('good');
      expect(item?.error).toBeNull();
      expect(item?.requiresReauth).toBe(false);
      expect(item?.transientSince).toBeNull();
    });
  });
});
