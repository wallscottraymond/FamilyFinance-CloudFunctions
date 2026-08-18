/**
 * One-off: regenerate a single user's user_summaries with the transfer-filter fix.
 *
 * Mirrors the deployed `regenerateAllUserSummaries` callable but runs locally with
 * the service-account key (the callable needs an authenticated client). Writes ONLY
 * user_summaries docs — nothing watches that collection, so ZERO triggers/cascade.
 *
 * Usage: node scripts/regen-summaries-oneoff.js <uid> [--dry]
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';
const UID = process.argv[2];
const DRY = process.argv.includes('--dry');

if (!UID) {
  console.error('Usage: node scripts/regen-summaries-oneoff.js <uid> [--dry]');
  process.exit(1);
}

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return admin.credential.cert(require(p));
  }
  return admin.credential.applicationDefault();
}

async function main() {
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  // Match the Cloud Functions runtime (src/index.ts) so `undefined` optional fields
  // (e.g. userCustomName) don't throw on write.
  db.settings({ ignoreUndefinedProperties: true });

  // Require the compiled writer AFTER admin is initialized (it grabs getFirestore()).
  const { updateUserPeriodSummary } = require(
    path.resolve(__dirname, '../lib/functions/summaries/orchestration/updateUserPeriodSummary.js')
  );

  // Collect unique (periodType, sourcePeriodId) from the user's active periods.
  const unique = new Map();
  const add = (data) => {
    if (!data.periodType || !data.sourcePeriodId) return;
    const pt = String(data.periodType).toLowerCase();
    unique.set(`${pt}_${data.sourcePeriodId}`, { periodType: pt, sourcePeriodId: data.sourcePeriodId });
  };
  const [b, o, i] = await Promise.all([
    db.collection('budget_periods').where('userId', '==', UID).where('isActive', '==', true).get(),
    db.collection('outflow_periods').where('ownerId', '==', UID).where('isActive', '==', true).get(),
    db.collection('inflow_periods').where('ownerId', '==', UID).where('isActive', '==', true).get(),
  ]);
  b.docs.forEach((d) => add(d.data()));
  o.docs.forEach((d) => add(d.data()));
  i.docs.forEach((d) => add(d.data()));

  const periods = Array.from(unique.values());
  console.log(`[regen] uid=${UID} | budget=${b.size} outflow=${o.size} inflow=${i.size} → ${periods.length} unique summaries`);
  if (DRY) {
    console.log('[regen] --dry: not writing. Sample:', periods.slice(0, 5));
    return;
  }

  let ok = 0, err = 0;
  for (const p of periods) {
    try {
      await updateUserPeriodSummary(UID, p.periodType, p.sourcePeriodId, true);
      ok++;
      if (ok % 25 === 0) console.log(`[regen] ${ok}/${periods.length}`);
    } catch (e) {
      err++;
      console.error(`[regen] FAIL ${p.periodType} ${p.sourcePeriodId}: ${e.message}`);
    }
  }
  console.log(`[regen] DONE. rewrote=${ok} errors=${err}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
