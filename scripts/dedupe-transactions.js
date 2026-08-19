/**
 * One-off: de-duplicate transactions that share a Plaid transactionId across
 * multiple active docs (a concurrent-sync race created extra docs). Keeps the
 * OLDEST createdAt active per plaid id, deactivates the rest (isActive:false).
 * Deactivation fires on_transaction_written → budget spend self-corrects
 * (removes the double-count).
 *
 * Usage: node scripts/dedupe-transactions.js <uid> [--apply]
 */
const path=require('path'),os=require('os'),admin=require('firebase-admin');
const OWNER=process.argv[2], APPLY=process.argv.includes('--apply');
if(!OWNER){console.error('Usage: node scripts/dedupe-transactions.js <uid> [--apply]');process.exit(1);}
admin.initializeApp({credential:admin.credential.cert(require(path.join(os.homedir(),'google-service-account-key.json'))),projectId:'family-budget-app-cb59b'});
const db=admin.firestore();db.settings({ignoreUndefinedProperties:true});
(async()=>{
  const snap=await db.collection('transactions').where('ownerId','==',OWNER).get();
  const act=snap.docs.map(d=>({id:d.id,ref:d.ref,...d.data()})).filter(t=>t.isActive!==false);
  const by={}; act.forEach(t=>{if(t.transactionId)(by[t.transactionId]=by[t.transactionId]||[]).push(t);});
  const dups=Object.entries(by).filter(([,a])=>a.length>1);
  let deactivated=0; let batch=db.batch(), n=0;
  for(const [pid,arr] of dups){
    arr.sort((a,b)=>{const ac=a.createdAt&&a.createdAt.toMillis?a.createdAt.toMillis():0,bc=b.createdAt&&b.createdAt.toMillis?b.createdAt.toMillis():0;return ac-bc;});
    const keep=arr[0]; const drop=arr.slice(1);
    console.log(`plaid ...${pid.slice(-8)} × ${arr.length}: keep ${keep.id}, drop ${drop.map(d=>d.id).join(',')}`);
    for(const d of drop){deactivated++; if(APPLY){batch.update(d.ref,{isActive:false,dedupedAt:admin.firestore.Timestamp.now()}); if(++n>=400){await batch.commit();batch=db.batch();n=0;}}}
  }
  if(APPLY&&n>0)await batch.commit();
  console.log(`\nduplicate plaid ids: ${dups.length} | docs to deactivate: ${deactivated} ${APPLY?'[APPLIED]':'[dry-run]'}`);
})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
