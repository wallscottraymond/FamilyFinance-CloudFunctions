import * as cors from "cors";
import { CORS_CONFIG } from "../config/constants";

// Create CORS middleware with configuration
export const corsMiddleware = cors.default({
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (CORS_CONFIG.origin.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow localhost origins in development
    if (process.env.NODE_ENV === "development" && origin.includes("localhost")) {
      return callback(null, true);
    }
    
    // Reject other origins
    callback(new Error("Not allowed by CORS"));
  },
  credentials: CORS_CONFIG.credentials,
  methods: CORS_CONFIG.methods,
  allowedHeaders: CORS_CONFIG.allowedHeaders,
});

// CORS middleware specifically for Firebase Functions
export const firebaseCors = cors.default({
  origin: true, // Allow all origins for Firebase Functions
  credentials: true,
});