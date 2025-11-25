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
exports.makeUserAdmin = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
/**
 * Make the current user an admin (Development Only)
 * This bypasses normal security for local development
 */
exports.makeUserAdmin = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error("Must be authenticated");
    }
    const userId = request.auth.uid;
    const db = admin.firestore();
    try {
        // Update user document to admin role
        await db.collection("users").doc(userId).set({
            role: "admin",
            email: request.auth.token.email || "dev@example.com",
            displayName: request.auth.token.name || "Dev User",
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        // Also set custom claims for role-based access
        await admin.auth().setCustomUserClaims(userId, {
            role: "admin",
        });
        return {
            success: true,
            message: "You are now an admin! Refresh the app to apply changes.",
            userId,
            role: "admin"
        };
    }
    catch (error) {
        console.error("Error making user admin:", error);
        throw new Error(`Failed to make user admin: ${error.message}`);
    }
});
//# sourceMappingURL=makeUserAdmin.js.map