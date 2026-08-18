/**
 * One-off: heal stale pending transactions.
 *
 * Real Plaid pending resolves in ~1-5 days. Active pending transactions older than
 * a threshold are stale (they posted during a sync gap and the pending→posted
 * migration never applied; the sync cursor has passed them so a normal sync won't
 * self-heal). For each stale pending:
 *   - if a POSTED sibling exists (same account + |amount|, within ±window days,
 *     isPending:false, different doc) → the pending is a duplicate → DEACTIVATE it.
 *   - else → the pending never got its posted update → FLIP it to posted.
 *
 * Then callers should re-reconcile affected recurring so the "pending" flag clears.
 *
 * Usage: node scripts/heal-stale-pending.js <uid> [--apply] [--days N]
 */
const path=require('path'), os=require('os'), admin=require('firebase-admin');
const OWNER=process.argv[2];
const APPLY=process.argv.includes('--apply');
const DAYS=(()=>{const i=process.argv.indexOf('--days');return i>=0?Number(process.argv[i+1]):7;})();
if(!OWNER){console.error('Usage: node scripts/heal-stale-pending.js <uid> [--apply] [--days N]');process.exit(1);}
admin.initializeApp({credential:admin.credential.cert(require(path.join(os.homedir(),'google-service-account-key.json'))),projectId:'family-budget-app-cb59b'});
const db=admin.firestore(); db.settings({ignoreUndefinedProperties:true});
const WINDOW=10*864e5;
(async()=>{
  const snap=await db.collection('transactions').where('ownerId','==',OWNER).get();
  const active=snap.docs.map(d=>({id:d.id,ref:d.ref,...d.data()})).filter(t=>t.isActive!==false);
  const posted=active.filter(t=>t.isPending!==true);
  const now=Date.now();
  const stalePending=active.filter(t=>t.isPending===true && t.transactionDate && (now-t.transactionDate.toMillis())>DAYS*864e5);
  let deactivate=0, flip=0; const ex=[];
  let batch=db.batch(), n=0;
  for(const p of stalePending){
    const pms=p.transactionDate.toMillis(), pamt=Math.abs(p.amount||0), acct=p.accountId;
    const sibling=posted.find(q=>q.accountId===acct && Math.abs(Math.abs(q.amount||0)-pamt)<0.005 && q.transactionDate && Math.abs(q.transactionDate.toMillis()-pms)<=WINDOW);
    const action=sibling?'DEACTIVATE(dup)':'FLIP→posted';
    if(sibling)deactivate++;else flip++;
    if(ex.length<20)ex.push(`${p.transactionDate.toDate().toISOString().slice(0,10)} $${pamt} ${(p.name||'').slice(0,32).padEnd(32)} → ${action}`);
    if(APPLY){
      if(sibling) batch.update(p.ref,{isActive:false,healedStalePendingAt:admin.firestore.Timestamp.now()});
      else batch.update(p.ref,{isPending:false,healedStalePendingAt:admin.firestore.Timestamp.now()});
      if(++n>=400){await batch.commit();batch=db.batch();n=0;}
    }
  }
  if(APPLY&&n>0)await batch.commit();
  console.log(`stale pending (>${DAYS}d): ${stalePending.length} → deactivate(dup)=${deactivate}, flip→posted=${flip} ${APPLY?'[APPLIED]':'[dry-run]'}`);
  ex.forEach(e=>console.log('  '+e));
})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
