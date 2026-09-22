#!/usr/bin/env node
/**
 * Enable a Firestore TTL policy on <collection>.<field> via the Firestore Admin REST API
 * (no gcloud needed). Firestore then auto-deletes docs whose <field> timestamp is in the past,
 * server-side, with NO read cost and no cleanup function.
 *
 *   node scripts/enable-firestore-ttl.js <collection> <field> [--confirm]
 *
 * Dry-run by default (prints the request). Pass --confirm to actually set the policy.
 * Uses the same service-account key as scripts/inspect-firestore.js — it must have Firestore
 * admin permission (roles/datastore.owner or datastore.indexes.update).
 *
 * WARNING: enabling TTL on a CREATION-time field deletes ALL existing docs (their timestamp is
 * already in the past). Only do that for disposable collections (old logs).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';
const [collection, field] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CONFIRM = process.argv.includes('--confirm');

if (!collection || !field) {
  console.error('Usage: node scripts/enable-firestore-ttl.js <collection> <field> [--confirm]');
  process.exit(1);
}

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) { /* next */ }
  }
  return admin.credential.applicationDefault();
}

async function main() {
  const cred = resolveCredential();
  admin.initializeApp({ credential: cred, projectId: PROJECT_ID });
  const { access_token } = await cred.getAccessToken();

  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/` +
    `collectionGroups/${encodeURIComponent(collection)}/fields/${encodeURIComponent(field)}` +
    `?updateMask=ttlConfig`;
  const body = { ttlConfig: {} }; // empty ttlConfig = enable TTL on this field

  console.error(`TTL target: ${collection}.${field}`);
  console.error(`PATCH ${url}`);
  if (!CONFIRM) {
    console.error('DRY RUN — pass --confirm to apply. Nothing changed.');
    return;
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ ${res.status} ${res.statusText}\n${text}`);
    process.exit(1);
  }
  console.log(`✅ TTL enable requested for ${collection}.${field} (long-running op):`);
  console.log(text);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
