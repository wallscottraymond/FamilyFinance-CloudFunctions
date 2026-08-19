/**
 * One-off: recompute materialized period amounts for recurring items that already
 * have an expectedAmountOverride (set before the on_recurring_updated amount-recompute
 * fix). Forces runUpdate*Periods by passing a synthetic "before" without the override
 * so it detects the effective-amount change and rewrites the periods → summaries refresh.
 *
 * Usage: node scripts/backfill-override-periods.js <uid> [--apply]
 */
const path=require('path'),os=require('os'),admin=require('firebase-admin');
const OWNER=process.argv[2], APPLY=process.argv.includes('--apply');
if(!OWNER){console.error('Usage: node scripts/backfill-override-periods.js <uid> [--apply]');process.exit(1);}
admin.initializeApp({credential:admin.credential.cert(require(path.join(os.homedir(),'google-service-account-key.json'))),projectId:'family-budget-app-cb59b'});
const db=admin.firestore();db.settings({ignoreUndefinedProperties:true});
(async()=>{
  const {runUpdateOutflowPeriods}=require(path.resolve(__dirname,'../lib/functions/outflows/outflow_periods/utils/runUpdateOutflowPeriods.js'));
  const {runUpdateInflowPeriods}=require(path.resolve(__dirname,'../lib/functions/inflows/inflow_periods/utils/runUpdateInflowPeriods.js'));
  const [outs,ins]=await Promise.all([
    db.collection('outflows').where('ownerId','==',OWNER).where('isActive','==',true).get(),
    db.collection('inflows').where('ownerId','==',OWNER).where('isActive','==',true).get(),
  ]);
  const items=[
    ...outs.docs.filter(d=>d.data().expectedAmountOverride!=null).map(d=>({id:d.id,type:'outflow',data:d.data()})),
    ...ins.docs.filter(d=>d.data().expectedAmountOverride!=null).map(d=>({id:d.id,type:'inflow',data:d.data()})),
  ];
  console.log(`recurring with an override: ${items.length}`);
  for(const it of items){
    console.log(`  ${it.type} ${it.data.userCustomName||it.data.merchantName||it.id}: override=${it.data.expectedAmountOverride} avg=${it.data.averageAmount}`);
    if(!APPLY)continue;
    const after=it.data;
    const before={...after, expectedAmountOverride:null}; // synthetic → effective differs → recompute
    try{
      if(it.type==='outflow') await runUpdateOutflowPeriods(db,it.id,before,after);
      else await runUpdateInflowPeriods(db,it.id,before,after);
      console.log('     ✓ periods recomputed');
    }catch(e){console.error('     FAIL:',e.message);}
  }
  console.log(APPLY?'[APPLIED]':'[dry-run]');
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
