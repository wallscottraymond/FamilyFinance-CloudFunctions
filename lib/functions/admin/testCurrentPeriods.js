"use strict";
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
exports.testCurrentPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Test function to check current period detection logic
 * Shows what today's date looks like server-side vs what periods are marked as current
 */
exports.testCurrentPeriods = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
        }
        try {
            const db = admin.firestore();
            const today = admin.firestore.Timestamp.now();
            const todayDate = today.toDate();
            console.log(`Server time check: ${todayDate.toISOString()}`);
            // Get all current periods
            const currentPeriodsQuery = await db.collection('source_periods')
                .where('isCurrent', '==', true)
                .get();
            const currentPeriods = currentPeriodsQuery.docs.map(doc => {
                const data = doc.data();
                const startDate = data.startDate.toDate();
                const endDate = data.endDate.toDate();
                return {
                    id: data.id,
                    type: data.type,
                    index: data.index,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    isInRange: todayDate >= startDate && todayDate <= endDate,
                    daysFromStart: Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
                    daysToEnd: Math.floor((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
                };
            });
            // Check what should be current based on today's date
            const allPeriodsQuery = await db.collection('source_periods')
                .get();
            const shouldBeCurrentPeriods = [];
            allPeriodsQuery.docs.forEach(doc => {
                const data = doc.data();
                const startDate = data.startDate.toDate();
                const endDate = data.endDate.toDate();
                if (todayDate >= startDate && todayDate <= endDate) {
                    shouldBeCurrentPeriods.push({
                        id: data.id,
                        type: data.type,
                        index: data.index,
                        startDate: startDate.toISOString(),
                        endDate: endDate.toISOString(),
                        isMarkedCurrent: data.isCurrent === true
                    });
                }
            });
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                serverInfo: {
                    serverTime: todayDate.toISOString(),
                    serverTimeUTC: todayDate.toUTCString(),
                    serverTimezone: todayDate.getTimezoneOffset(),
                    timestampSeconds: today.seconds
                },
                currentPeriodsMarked: {
                    count: currentPeriods.length,
                    periods: currentPeriods
                },
                shouldBeCurrentPeriods: {
                    count: shouldBeCurrentPeriods.length,
                    periods: shouldBeCurrentPeriods
                },
                analysis: {
                    correctlyMarked: shouldBeCurrentPeriods.filter(p => p.isMarkedCurrent).length,
                    incorrectlyMarked: currentPeriods.filter(p => !p.isInRange).length,
                    needsUpdate: shouldBeCurrentPeriods.length !== currentPeriods.length ||
                        shouldBeCurrentPeriods.some(p => !p.isMarkedCurrent)
                }
            }));
        }
        catch (error) {
            console.error("Error testing current periods:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to test current periods"));
        }
    });
});
//# sourceMappingURL=testCurrentPeriods.js.map