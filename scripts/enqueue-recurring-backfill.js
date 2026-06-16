#!/usr/bin/env node
/**
 * enqueue-recurring-backfill.js — one-off: enqueue the recurring-reconciliation
 * backfill coordinator job for a single user (or all). WRITES one `_jobs` doc via
 * the compiled `create_job`; the deployed `on_job_created` processes it.
 *
 * Usage:
 *   node scripts/enqueue-recurring-backfill.js <userId>               # one user, reconcile only
 *   node scripts/enqueue-recurring-backfill.js <userId> --regenerate  # regenerate occurrence data, then reconcile
 *   node scripts/enqueue-recurring-backfill.js --all-users [--regenerate]
 */
'use strict';

const path = require('path');
const admin = require('firebase-admin');

const key = require(path.join(process.env.HOME, 'google-service-account-key.json'));
admin.initializeApp({
  credential: admin.credential.cert(key),
  projectId: 'family-budget-app-cb59b',
});

const { create_job } = require('../lib/functions/infrastructure/job_queue');

(async () => {
  const args = process.argv.slice(2);
  const regenerate = args.includes('--regenerate');
  const arg = args.find((a) => a !== '--regenerate');
  if (!arg) {
    console.error('Usage: node scripts/enqueue-recurring-backfill.js <userId|--all-users> [--regenerate]');
    process.exit(1);
  }
  const payload = arg === '--all-users' ? { regenerate } : { user_id: arg, regenerate };
  const job = await create_job('backfill_recurring_reconciliation', payload, {
    trace_id: `manual_backfill_${Date.now()}`,
  });
  console.error(
    `✅ enqueued backfill job ${job.job_id} (scope: ${arg}${regenerate ? ', regenerate' : ''})`
  );
  process.exit(0);
})().catch((e) => {
  console.error('❌ failed:', e.message);
  process.exit(1);
});
