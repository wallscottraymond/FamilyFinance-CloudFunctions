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
exports.getUserStatistics = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Get user statistics
 */
exports.getUserStatistics = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const targetUserId = request.query.userId || user.id;
            // Check if user can access target user's statistics
            if (targetUserId !== user.id) {
                const hasAccess = await (0, auth_1.checkUserAccess)(user.id, targetUserId);
                if (!hasAccess) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this user's statistics"));
                }
            }
            if (!user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family"));
            }
            // Get user transactions for statistics
            const db = admin.firestore();
            const transactionsRef = db.collection("transactions");
            // Get current month transactions
            const currentMonthStart = new Date();
            currentMonthStart.setDate(1);
            currentMonthStart.setHours(0, 0, 0, 0);
            const currentMonthTransactions = await transactionsRef
                .where("userId", "==", targetUserId)
                .where("familyId", "==", user.familyId)
                .where("status", "==", "approved")
                .where("date", ">=", admin.firestore.Timestamp.fromDate(currentMonthStart))
                .get();
            // Calculate statistics
            let totalIncome = 0;
            let totalExpenses = 0;
            let transactionCount = 0;
            currentMonthTransactions.forEach(doc => {
                const transaction = doc.data();
                if (transaction.type === "income") {
                    totalIncome += transaction.amount;
                }
                else if (transaction.type === "expense") {
                    totalExpenses += transaction.amount;
                }
                transactionCount++;
            });
            const statistics = {
                currentMonth: {
                    totalIncome,
                    totalExpenses,
                    netAmount: totalIncome - totalExpenses,
                    transactionCount,
                },
                period: {
                    start: currentMonthStart.toISOString(),
                    end: new Date().toISOString(),
                },
            };
            return response.status(200).json((0, auth_1.createSuccessResponse)(statistics));
        }
        catch (error) {
            console.error("Error getting user statistics:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get user statistics"));
        }
    });
});
//# sourceMappingURL=getUserStatistics.js.map