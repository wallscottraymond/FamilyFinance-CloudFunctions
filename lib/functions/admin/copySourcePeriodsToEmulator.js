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
exports.exportSourcePeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
/**
 * Copy source_periods collection to emulator
 *
 * This function fetches all source_periods from production Firestore
 * and returns them as JSON that can be imported to the emulator.
 *
 * Usage from emulator:
 * Call this function, then write the results to emulator Firestore
 */
exports.exportSourcePeriods = (0, https_1.onCall)(async (request) => {
    // Optional: Add authentication check
    // if (!request.auth) {
    //   throw new HttpsError("unauthenticated", "Must be authenticated");
    // }
    try {
        console.log("Fetching source_periods from Firestore...");
        const db = admin.firestore();
        const snapshot = await db.collection("source_periods").get();
        console.log(`Found ${snapshot.size} source_periods documents`);
        const documents = [];
        snapshot.forEach(doc => {
            documents.push({
                id: doc.id,
                data: doc.data()
            });
        });
        return {
            success: true,
            count: documents.length,
            documents
        };
    }
    catch (error) {
        console.error("Error exporting source_periods:", error);
        throw new https_1.HttpsError("internal", "Failed to export source_periods");
    }
});
//# sourceMappingURL=copySourcePeriodsToEmulator.js.map