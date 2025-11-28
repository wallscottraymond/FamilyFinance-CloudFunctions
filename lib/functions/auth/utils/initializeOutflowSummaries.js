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
exports.initializeOutflowSummaries = initializeOutflowSummaries;
exports.initializeGroupOutflowSummaries = initializeGroupOutflowSummaries;
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../types");
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
/**
 * Initialize outflow summary documents for a new user
 * Creates 3 empty summary documents (monthly, weekly, bi-weekly)
 */
async function initializeOutflowSummaries(userId) {
    console.log(`📊 Initializing outflow summaries for user: ${userId}`);
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setFullYear(now.getFullYear() - 1);
    const windowEnd = new Date(now);
    windowEnd.setFullYear(now.getFullYear() + 1);
    const periodTypes = [types_1.PeriodType.MONTHLY, types_1.PeriodType.WEEKLY, types_1.PeriodType.BI_MONTHLY];
    const batch = db.batch();
    for (const periodType of periodTypes) {
        const docId = `${userId}_outflowsummary_${periodType.toLowerCase()}`;
        const docRef = db.collection('outflowSummaries').doc(docId);
        // Check if document already exists
        const existingDoc = await docRef.get();
        if (existingDoc.exists) {
            console.log(`✓ Summary already exists: ${docId}`);
            continue;
        }
        const summary = {
            ownerId: userId,
            ownerType: 'user',
            periodType,
            resourceType: 'outflow',
            windowStart: Timestamp.fromDate(windowStart),
            windowEnd: Timestamp.fromDate(windowEnd),
            periods: [], // Empty initially
            totalItemCount: 0,
            lastRecalculated: Timestamp.now(),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };
        batch.set(docRef, summary);
        console.log(`✓ Creating summary: ${docId}`);
    }
    await batch.commit();
    console.log(`✅ Initialized ${periodTypes.length} outflow summaries for user ${userId}`);
}
/**
 * Initialize group outflow summary documents for a group
 * Creates 3 empty summary documents (monthly, weekly, bi-weekly)
 */
async function initializeGroupOutflowSummaries(groupId) {
    console.log(`📊 Initializing group outflow summaries for group: ${groupId}`);
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setFullYear(now.getFullYear() - 1);
    const windowEnd = new Date(now);
    windowEnd.setFullYear(now.getFullYear() + 1);
    const periodTypes = [types_1.PeriodType.MONTHLY, types_1.PeriodType.WEEKLY, types_1.PeriodType.BI_MONTHLY];
    const batch = db.batch();
    for (const periodType of periodTypes) {
        const docId = `${groupId}_outflowsummary_${periodType.toLowerCase()}`;
        const docRef = db.collection('groupOutflowSummaries').doc(docId);
        // Check if document already exists
        const existingDoc = await docRef.get();
        if (existingDoc.exists) {
            console.log(`✓ Group summary already exists: ${docId}`);
            continue;
        }
        const summary = {
            ownerId: groupId,
            ownerType: 'group',
            periodType,
            resourceType: 'outflow',
            windowStart: Timestamp.fromDate(windowStart),
            windowEnd: Timestamp.fromDate(windowEnd),
            periods: [], // Empty initially
            totalItemCount: 0,
            lastRecalculated: Timestamp.now(),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };
        batch.set(docRef, summary);
        console.log(`✓ Creating group summary: ${docId}`);
    }
    await batch.commit();
    console.log(`✅ Initialized ${periodTypes.length} group outflow summaries for group ${groupId}`);
}
//# sourceMappingURL=initializeOutflowSummaries.js.map