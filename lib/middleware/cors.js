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
exports.firebaseCors = exports.corsMiddleware = void 0;
const cors = __importStar(require("cors"));
const constants_1 = require("../config/constants");
// Create CORS middleware with configuration
exports.corsMiddleware = cors.default({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        // Check if origin is in allowed list
        if (constants_1.CORS_CONFIG.origin.includes(origin)) {
            return callback(null, true);
        }
        // Allow localhost origins in development
        if (process.env.NODE_ENV === "development" && origin.includes("localhost")) {
            return callback(null, true);
        }
        // Reject other origins
        callback(new Error("Not allowed by CORS"));
    },
    credentials: constants_1.CORS_CONFIG.credentials,
    methods: constants_1.CORS_CONFIG.methods,
    allowedHeaders: constants_1.CORS_CONFIG.allowedHeaders,
});
// CORS middleware specifically for Firebase Functions
exports.firebaseCors = cors.default({
    origin: true, // Allow all origins for Firebase Functions
    credentials: true,
});
//# sourceMappingURL=cors.js.map