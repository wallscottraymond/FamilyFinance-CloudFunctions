"use strict";
/**
 * Test script for updateCurrentPeriods function logic
 * This script simulates the function behavior without actually running Firebase Functions
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
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../types");
// Initialize Firebase Admin for testing (will use emulator or your test project)
if (!admin.apps.length) {
    admin.initializeApp();
}
/**
 * Test the logic for finding current periods
 */
async function testUpdateCurrentPeriodsLogic() {
    const db = admin.firestore();
    const today = admin.firestore.Timestamp.now();
    console.log("Testing updateCurrentPeriods logic...");
    console.log("Current date:", today.toDate().toISOString());
    try {
        // Get all source periods
        const sourcePeriodsRef = db.collection("source_periods");
        const allPeriodsSnapshot = await sourcePeriodsRef.get();
        if (allPeriodsSnapshot.empty) {
            console.error("No source periods found. Please run generateSourcePeriods first.");
            return;
        }
        console.log(`Found ${allPeriodsSnapshot.size} source periods`);
        // Track periods that should be marked as current
        const currentPeriods = {
            [types_1.PeriodType.MONTHLY]: null,
            [types_1.PeriodType.WEEKLY]: null,
            [types_1.PeriodType.BI_MONTHLY]: null
        };
        let currentlyMarkedAsCurrent = 0;
        let shouldBeMarkedAsCurrent = 0;
        // Process all periods and find current ones
        allPeriodsSnapshot.forEach((doc) => {
            const period = Object.assign({ id: doc.id }, doc.data());
            // Count how many are currently marked as current
            if (period.isCurrent) {
                currentlyMarkedAsCurrent++;
            }
            // Check if this period contains today's date
            const isCurrentPeriod = today.toDate() >= period.startDate.toDate() &&
                today.toDate() <= period.endDate.toDate();
            if (isCurrentPeriod) {
                currentPeriods[period.type] = period;
                shouldBeMarkedAsCurrent++;
                console.log(`Found current ${period.type} period:`, {
                    periodId: period.periodId,
                    startDate: period.startDate.toDate().toISOString(),
                    endDate: period.endDate.toDate().toISOString(),
                    year: period.year,
                    index: period.index,
                    currentlyMarked: period.isCurrent
                });
            }
        });
        // Summary of what would be updated
        console.log("\n=== UPDATE SUMMARY ===");
        console.log(`Currently marked as current: ${currentlyMarkedAsCurrent} periods`);
        console.log(`Should be marked as current: ${shouldBeMarkedAsCurrent} periods`);
        console.log("\nCurrent periods that should be marked:");
        for (const [periodType, currentPeriod] of Object.entries(currentPeriods)) {
            if (currentPeriod) {
                console.log(`- ${periodType}: ${currentPeriod.periodId} (${currentPeriod.startDate.toDate().toLocaleDateString()} - ${currentPeriod.endDate.toDate().toLocaleDateString()})`);
            }
            else {
                console.log(`- ${periodType}: NOT FOUND (this is a problem!)`);
            }
        }
        // Check for potential issues
        if (shouldBeMarkedAsCurrent !== 3) {
            console.warn(`\nWARNING: Expected to find 3 current periods (monthly, weekly, bi-monthly), but found ${shouldBeMarkedAsCurrent}`);
        }
        const incorrectlyMarked = currentlyMarkedAsCurrent - shouldBeMarkedAsCurrent;
        if (incorrectlyMarked !== 0) {
            console.log(`\nINFO: ${Math.abs(incorrectlyMarked)} periods are ${incorrectlyMarked > 0 ? 'incorrectly marked as current' : 'missing current marking'}`);
        }
        console.log("\nTest completed successfully!");
    }
    catch (error) {
        console.error("Error testing updateCurrentPeriods logic:", error);
    }
}
// Run the test
testUpdateCurrentPeriodsLogic()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
});
//# sourceMappingURL=test-update-current-periods.js.map