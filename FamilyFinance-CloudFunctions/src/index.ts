import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();

// Export all function modules
export * from "./functions/auth";
export * from "./functions/users"; // Includes auth triggers (onUserCreate, onUserDelete)
export * from "./functions/families";
export * from "./functions/transactions";
export * from "./functions/budgets";
export * from "./functions/categories"; // Categories management functions
export * from "./functions/admin";
export * from "./functions/plaid"; // Plaid integration functions

// Health check function (v2)
export const healthCheck = onRequest({
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
db.settings({
  timestampsInSnapshots: true,
  ignoreUndefinedProperties: true,
});

export { db };