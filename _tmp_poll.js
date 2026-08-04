const admin = require('firebase-admin');
const key = require(process.env.HOME + '/google-service-account-key.json');
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const U = 'VrXZSGuPvyaTw8kuXVrzZZYcEQe2';
const EE = 'OF07zCkosDFOiSggypiX';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function count() {
  const snap = await db.collection('transactions').where('ownerId','==',U).get();
  let ee=0, un=0, total=0;
  snap.docs.forEach(d => (d.data().splits||[]).forEach(s => {
    const cat = s.internalDetailedCategory ?? s.plaidDetailedCategory ?? '';
    if (!cat.startsWith('TRANSFER_OUT')) return;
    total++;
    const mid = s.monthlyBudgetId ?? s.budgetId ?? 'UNASSIGNED';
    if (mid === EE) ee++; else if (mid==='UNASSIGNED'||mid==='unassigned'||!mid) un++;
  }));
  return { ee, un, total };
}
(async () => {
  for (let i = 0; i < 20; i++) {
    const c = await count();
    console.log(`[poll ${i}] TRANSFER_OUT → EE=${c.ee}, unassigned=${c.un} / ${c.total}`);
    if (c.ee <= 20) { console.log('BACKFILL ~COMPLETE for TRANSFER_OUT'); break; }
    await sleep(45000);
  }
  process.exit(0);
})();
