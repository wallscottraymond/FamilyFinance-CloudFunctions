"use strict";
/**
 * Admin Function: Extend Outflow Periods
 *
 * Extends existing outflow periods by generating additional periods forward in time.
 * This is useful when existing outflows need periods extended beyond their current range.
 *
 * Usage:
 * POST https://us-central1-{project}.cloudfunctions.net/extendOutflowPeriods
 * Body: {
 *   "outflowId": "outflow_id_here",  // Optional: specific outflow
 *   "userId": "user_id_here",        // Optional: all outflows for user
 *   "monthsForward": 15              // Optional: default 15
 * }
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendOutflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const createOutflowPeriods_1 = require("../outflow_periods/crud/createOutflowPeriods");
exports.extendOutflowPeriods = (0, https_1.onRequest)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
}, async (req, res) => {
    try {
        const { outflowId, userId, monthsForward = 15 } = req.body;
        if (!outflowId && !userId) {
            res.status(400).json({
                success: false,
                message: 'Either outflowId or userId must be provided'
            });
            return;
        }
        const db = admin.firestore();
        let outflowsToExtend = [];
        // Get outflows to extend
        if (outflowId) {
            const outflowDoc = await db.collection('outflows').doc(outflowId).get();
            if (!outflowDoc.exists) {
                res.status(404).json({
                    success: false,
                    message: `Outflow ${outflowId} not found`
                });
                return;
            }
            outflowsToExtend.push({
                id: outflowDoc.id,
                data: outflowDoc.data()
            });
        }
        else if (userId) {
            const outflowsSnapshot = await db.collection('outflows')
                .where('userId', '==', userId)
                .where('isActive', '==', true)
                .get();
            outflowsToExtend = outflowsSnapshot.docs.map(doc => ({
                id: doc.id,
                data: doc.data()
            }));
        }
        console.log(`[extendOutflowPeriods] Extending ${outflowsToExtend.length} outflows`);
        const results = {
            success: true,
            outflowsProcessed: 0,
            periodsCreated: 0,
            errors: []
        };
        for (const outflow of outflowsToExtend) {
            try {
                // Find the latest existing period for this outflow
                const existingPeriodsSnapshot = await db.collection('outflow_periods')
                    .where('outflowId', '==', outflow.id)
                    .orderBy('periodEndDate', 'desc')
                    .limit(1)
                    .get();
                let startDate;
                if (existingPeriodsSnapshot.empty) {
                    // No existing periods, start from firstDate
                    console.log(`[extendOutflowPeriods] No existing periods for ${outflow.id}, starting from firstDate`);
                    startDate = outflow.data.firstDate.toDate();
                }
                else {
                    // Start from the day after the latest period ends
                    const latestPeriod = existingPeriodsSnapshot.docs[0].data();
                    startDate = latestPeriod.periodEndDate.toDate();
                    startDate.setDate(startDate.getDate() + 1); // Start from next day
                    console.log(`[extendOutflowPeriods] Latest period for ${outflow.id} ends ${latestPeriod.periodEndDate.toDate().toISOString()}`);
                }
                // Calculate end date (N months forward from now)
                const now = new Date();
                const endDate = new Date(now);
                endDate.setMonth(endDate.getMonth() + monthsForward);
                console.log(`[extendOutflowPeriods] Generating periods for ${outflow.id} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
                // Only create periods if startDate is before endDate
                if (startDate >= endDate) {
                    console.log(`[extendOutflowPeriods] Outflow ${outflow.id} already has periods through ${startDate.toISOString()}, skipping`);
                    continue;
                }
                // Create new periods
                const result = await (0, createOutflowPeriods_1.createOutflowPeriodsFromSource)(db, outflow.id, outflow.data, startDate, endDate);
                results.outflowsProcessed++;
                results.periodsCreated += result.periodsCreated;
                console.log(`[extendOutflowPeriods] Created ${result.periodsCreated} periods for outflow ${outflow.id}`);
            }
            catch (error) {
                const errorMsg = `Failed to extend outflow ${outflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                results.errors.push(errorMsg);
                console.error(`[extendOutflowPeriods] ${errorMsg}`);
            }
        }
        res.json({
            success: true,
            outflowsProcessed: results.outflowsProcessed,
            periodsCreated: results.periodsCreated,
            errors: results.errors,
            message: `Extended ${results.outflowsProcessed} outflows, created ${results.periodsCreated} new periods`
        });
    }
    catch (error) {
        console.error('[extendOutflowPeriods] Error:', error);
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
//# sourceMappingURL=extendOutflowPeriods.js.map