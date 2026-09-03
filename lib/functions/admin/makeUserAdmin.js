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
 * Grant admin role to a user.
 *
 * SECURITY: the CALLER must already be an admin. This prevents any
 * authenticated user from self-escalating to admin. The very first admin
 * must be bootstrapped out-of-band (Firebase console custom claim
 * `role: "admin"`, or the `users/{uid}.role` field + a token refresh).
 *
 * Target: defaults to the caller (re-affirm own admin); pass `data.targetUserId`
 * to promote another user.
 */
exports.makeUserAdmin = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request) => {
    var _a, _b;
    console.log('🔧 makeUserAdmin called');
    if (!request.auth) {
        console.error('❌ makeUserAdmin: Not authenticated');
        throw new https_1.HttpsError('unauthenticated', 'Must be authenticated to make user admin');
    }
    // Only an existing admin may grant admin (prevents self-escalation)
    const callerIsAdmin = ((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
    if (!callerIsAdmin) {
        console.error(`❌ makeUserAdmin: Non-admin caller attempted escalation: ${request.auth.uid}`);
        throw new https_1.HttpsError('permission-denied', 'Only an existing admin can grant admin access');
    }
    const userId = ((_b = request.data) === null || _b === void 0 ? void 0 : _b.targetUserId) || request.auth.uid;
    console.log(`👤 makeUserAdmin: admin ${request.auth.uid} promoting user ${userId}`);
    const db = admin.firestore();
    const isSelf = userId === request.auth.uid;
    try {
        // Update user document to admin role.
        // Only stamp email/displayName from the token when promoting SELF — otherwise
        // we'd overwrite the target user's identity with the caller's.
        console.log(`📝 Updating user document for ${userId}`);
        await db.collection("users").doc(userId).set(Object.assign(Object.assign({ role: "admin" }, (isSelf ? {
            email: request.auth.token.email || "dev@example.com",
            displayName: request.auth.token.name || "Dev User",
        } : {})), { updatedAt: admin.firestore.Timestamp.now() }), { merge: true });
        // Also set custom claims for role-based access
        console.log(`🔑 Setting custom claims for ${userId}`);
        await admin.auth().setCustomUserClaims(userId, {
            role: "admin",
        });
        console.log(`✅ Successfully made user ${userId} an admin`);
        return {
            success: true,
            message: "You are now an admin! Refresh the app to apply changes.",
            userId,
            role: "admin"
        };
    }
    catch (error) {
        console.error("❌ Error making user admin:", error);
        throw new https_1.HttpsError('internal', `Failed to make user admin: ${error.message}`);
    }
});
//# sourceMappingURL=makeUserAdmin.js.map