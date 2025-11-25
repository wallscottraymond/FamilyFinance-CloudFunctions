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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.healthCheck = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin
admin.initializeApp();
// Export all function modules
__exportStar(require("./functions/auth"), exports);
__exportStar(require("./functions/users"), exports); // Includes auth triggers (onUserCreate, onUserDelete)
__exportStar(require("./functions/sharing"), exports); // Group management (CRUD + orchestration triggers)
__exportStar(require("./functions/transactions"), exports);
__exportStar(require("./functions/budgets"), exports);
__exportStar(require("./functions/categories"), exports); // Categories management functions
__exportStar(require("./functions/admin"), exports);
__exportStar(require("./functions/plaid"), exports); // Plaid integration functions
__exportStar(require("./functions/outflows"), exports); // Outflow management functions
__exportStar(require("./functions/inflows"), exports); // Inflow management and period generation
// Health check function (v2)
exports.healthCheck = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, (request, response) => {
    response.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        generation: "v2"
    });
});
// Initialize Firestore with settings
const db = admin.firestore();
exports.db = db;
db.settings({
    timestampsInSnapshots: true,
    ignoreUndefinedProperties: true,
});
//# sourceMappingURL=index.js.map