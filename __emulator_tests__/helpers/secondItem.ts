/**
 * secondItem — a second Plaid item (+ one checking account) for a capture-scenario user, and a
 * sync driver for it. The suite's Plaid mocks are shared: each call installs this item's
 * responses before syncing (no new transactions unless given).
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { NOW_MS, ScenarioIds } from './captureScenario';

export interface SecondItem {
  itemDocId: string;
  chk: string;
  sync: (label: string, recurring: any, txns?: any[]) => Promise<any>;
}

export async function seedSecondItem(
  db: Firestore,
  ids: ScenarioIds,
  mocks: { mockSync: jest.Mock; mockRecurring: jest.Mock },
  suffix = '2'
): Promise<SecondItem> {
  const itemDocId = `${ids.tag}_item${suffix}`;
  const chk = `${ids.tag}_chk${suffix}`;
  const now = Timestamp.fromMillis(NOW_MS);
  const batch = db.batch();
  batch.set(db.collection('plaid_items').doc(itemDocId), {
    id: itemDocId, plaidItemId: itemDocId, userId: ids.userId, groupIds: [], accessToken: 'enc', cursor: null,
    isActive: true, institutionId: 'ins_2', institutionName: 'Other Bank', createdAt: now, updatedAt: now,
  });
  batch.set(db.collection('accounts').doc(chk), {
    id: chk, accountId: chk, userId: ids.userId, itemId: itemDocId, plaidItemId: itemDocId, institutionId: 'ins_2',
    institutionName: 'Other Bank', accountName: 'chk2', name: 'chk2', type: 'depository', subtype: 'checking',
    accountType: 'depository', accountSubtype: 'checking', currentBalance: 500, isActive: true, isDeleted: false,
    createdAt: now, updatedAt: now, access: { ownerId: ids.userId, createdBy: ids.userId, groupIds: [], isPrivate: true },
  });
  await batch.commit();
  const { sync_item_orchestrator } = require('../../src/functions/orchestrators/plaid/sync_item.orchestrator');
  let n = 0;
  return {
    itemDocId,
    chk,
    sync: async (label, recurring, txns = []) => {
      let pending = txns;
      mocks.mockSync.mockReset();
      mocks.mockSync.mockImplementation(async () => {
        const added = pending;
        pending = [];
        n++;
        return {
          added, modified: [], removed: [], next_cursor: `c2_${n}`, has_more: false,
          transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r',
        };
      });
      mocks.mockRecurring.mockReset();
      mocks.mockRecurring.mockImplementation(async () => recurring);
      const r = await sync_item_orchestrator({ trace_id: `${ids.tag}_i2_${label}`, span_id: 's' }, {
        item_doc_id: itemDocId, user_id: ids.userId, recurring: true, reason: 'test',
      });
      if (r.status !== 'synced') throw new Error(`second-item sync ${label}: ${r.status} ${r.error ?? ''}`);
      return r;
    },
  };
}
