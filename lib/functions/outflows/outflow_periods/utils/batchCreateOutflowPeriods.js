"use strict";
/**
 * Batch create outflow periods using Firestore batch operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchCreateOutflowPeriods = batchCreateOutflowPeriods;
/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 *
 * @param db - Firestore instance
 * @param outflowPeriods - Array of outflow periods to create
 */
async function batchCreateOutflowPeriods(db, outflowPeriods) {
    const BATCH_SIZE = 500; // Firestore batch limit
    for (let i = 0; i < outflowPeriods.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchPeriods = outflowPeriods.slice(i, i + BATCH_SIZE);
        batchPeriods.forEach((outflowPeriod) => {
            const docRef = db.collection('outflow_periods').doc(outflowPeriod.id);
            batch.set(docRef, outflowPeriod);
        });
        await batch.commit();
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(outflowPeriods.length / BATCH_SIZE);
        console.log(`[batchCreateOutflowPeriods] Created batch ${batchNumber}/${totalBatches} (${batchPeriods.length} periods)`);
    }
}
//# sourceMappingURL=batchCreateOutflowPeriods.js.map