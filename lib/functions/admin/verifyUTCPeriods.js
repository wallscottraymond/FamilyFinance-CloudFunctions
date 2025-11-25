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
exports.verifyUTCPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Verify if source periods are actually stored in UTC+0
 * This will show the raw timestamp values to confirm timezone
 */
exports.verifyUTCPeriods = (0, https_1.onRequest)({
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
            const sourcePeriodsRef = db.collection("source_periods");
            // Get a few sample periods to check
            const sampleQuery = await sourcePeriodsRef
                .where("year", "==", 2025)
                .where("type", "==", "monthly")
                .limit(3)
                .get();
            if (sampleQuery.empty) {
                return response.status(404).json((0, auth_1.createErrorResponse)("no-periods", "No periods found to verify"));
            }
            const verificationResults = sampleQuery.docs.map(doc => {
                const data = doc.data();
                const startDate = data.startDate.toDate();
                const endDate = data.endDate.toDate();
                return {
                    id: data.id,
                    type: data.type,
                    year: data.year,
                    rawTimestamps: {
                        startDate: {
                            firestoreTimestamp: data.startDate.seconds,
                            jsDate: startDate.toISOString(),
                            utcString: startDate.toUTCString(),
                            localString: startDate.toString(),
                            utcHours: startDate.getUTCHours(),
                            utcMinutes: startDate.getUTCMinutes(),
                            timezone: startDate.getTimezoneOffset()
                        },
                        endDate: {
                            firestoreTimestamp: data.endDate.seconds,
                            jsDate: endDate.toISOString(),
                            utcString: endDate.toUTCString(),
                            localString: endDate.toString(),
                            utcHours: endDate.getUTCHours(),
                            utcMinutes: endDate.getUTCMinutes(),
                            timezone: endDate.getTimezoneOffset()
                        }
                    },
                    isCorrectUTC: {
                        startDateIsUTCMidnight: startDate.getUTCHours() === 0 && startDate.getUTCMinutes() === 0,
                        endDateIsUTCEndOfDay: endDate.getUTCHours() === 23 && endDate.getUTCMinutes() === 59
                    }
                };
            });
            // Also create a test UTC date to compare
            const testUTCDate = new Date(Date.UTC(2025, 2, 1, 0, 0, 0, 0)); // March 1, 2025 UTC
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                message: "Period timezone verification results",
                serverTime: {
                    now: new Date().toISOString(),
                    utcNow: new Date().toUTCString(),
                    timezoneOffset: new Date().getTimezoneOffset()
                },
                testUTCDate: {
                    jsDate: testUTCDate.toISOString(),
                    utcString: testUTCDate.toUTCString(),
                    utcHours: testUTCDate.getUTCHours(),
                    shouldBeZero: testUTCDate.getUTCHours() === 0
                },
                periods: verificationResults,
                analysis: {
                    totalPeriodsChecked: verificationResults.length,
                    correctUTCCount: verificationResults.filter(p => p.isCorrectUTC.startDateIsUTCMidnight).length,
                    recommendation: verificationResults.every(p => p.isCorrectUTC.startDateIsUTCMidnight)
                        ? "Periods are correctly stored in UTC+0"
                        : "Periods need to be regenerated with proper UTC+0 timezone"
                }
            }));
        }
        catch (error) {
            console.error("Error verifying periods:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to verify period timezones"));
        }
    });
});
//# sourceMappingURL=verifyUTCPeriods.js.map