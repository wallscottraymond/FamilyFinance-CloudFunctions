"use strict";
/**
 * Categories Management Functions
 *
 * Provides CRUD operations for the categories collection to replace
 * hardcoded category mappings with dynamic database-driven approach.
 */
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
exports.getCategoryValidationList = exports.toggleCategoryStatus = exports.updateCategory = exports.addCategory = exports.getCategories = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
const auth_1 = require("../../utils/auth");
/**
 * Get categories with filtering options
 */
exports.getCategories = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        const { type = 'All', activeOnly = true, budgetSelectionOnly = false } = request.data;
        // No authentication required for reading categories
        const db = admin.firestore();
        console.log(`[getCategories] Fetching categories with filters:`, {
            type,
            activeOnly,
            budgetSelectionOnly
        });
        // Build query
        let query = db.collection('categories');
        // Filter by type
        if (type !== 'All') {
            query = query.where('type', '==', type);
        }
        // Filter by active status
        if (activeOnly) {
            query = query.where('isActive', '==', true);
        }
        // Filter by budget selection
        if (budgetSelectionOnly) {
            query = query.where('budget_selection', '==', true);
        }
        // Order by index for consistent ordering
        query = query.orderBy('index');
        const snapshot = await query.get();
        const categories = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            categories.push(Object.assign(Object.assign({ id: doc.id }, data), { createdAt: data.createdAt || admin.firestore.Timestamp.now(), updatedAt: data.updatedAt || admin.firestore.Timestamp.now(), isActive: data.isActive !== undefined ? data.isActive : true, isSystemCategory: data.isSystemCategory !== undefined ? data.isSystemCategory : true }));
        });
        console.log(`[getCategories] Retrieved ${categories.length} categories`);
        return {
            success: true,
            categories,
        };
    }
    catch (error) {
        console.error('[getCategories] Error:', error);
        return {
            success: false,
            categories: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
/**
 * Add a new custom category (Admin only)
 */
exports.addCategory = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user (admin only for adding categories)
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.ADMIN);
        if (!user || !userData) {
            throw new Error('Admin authentication required');
        }
        const categoryData = request.data;
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        console.log(`[addCategory] Admin ${user.uid} adding category:`, categoryData.name);
        // Get the highest index to assign next index
        const existingCategories = await db.collection('categories')
            .orderBy('index', 'desc')
            .limit(1)
            .get();
        const nextIndex = existingCategories.empty ? 1 :
            (existingCategories.docs[0].data().index || 0) + 1;
        // Create category document
        const category = Object.assign(Object.assign({}, categoryData), { index: nextIndex, isActive: true, isSystemCategory: false, createdBy: user.uid, createdAt: now, updatedAt: now });
        const docRef = await db.collection('categories').add(category);
        const createdCategory = Object.assign({ id: docRef.id }, category);
        console.log(`[addCategory] Successfully created category: ${docRef.id}`);
        return {
            success: true,
            category: createdCategory,
        };
    }
    catch (error) {
        console.error('[addCategory] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
/**
 * Update an existing category (Admin only)
 */
exports.updateCategory = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user (admin only for updating categories)
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.ADMIN);
        if (!user || !userData) {
            throw new Error('Admin authentication required');
        }
        const { categoryId, updates } = request.data;
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        console.log(`[updateCategory] Admin ${user.uid} updating category ${categoryId}`);
        // Get existing category
        const categoryRef = db.collection('categories').doc(categoryId);
        const categoryDoc = await categoryRef.get();
        if (!categoryDoc.exists) {
            throw new Error('Category not found');
        }
        const existingCategory = categoryDoc.data();
        // Prevent updating system categories in certain ways
        if (existingCategory.isSystemCategory) {
            // Only allow certain fields to be updated for system categories
            const allowedUpdates = ['visible_by_default', 'budget_selection', 'income_selection', 'transactionCategoryId'];
            const updateKeys = Object.keys(updates);
            const invalidUpdates = updateKeys.filter(key => !allowedUpdates.includes(key));
            if (invalidUpdates.length > 0) {
                throw new Error(`Cannot update system category fields: ${invalidUpdates.join(', ')}`);
            }
        }
        // Update category
        const updateData = Object.assign(Object.assign({}, updates), { updatedAt: now });
        await categoryRef.update(updateData);
        // Return updated category
        const updatedDoc = await categoryRef.get();
        const updatedCategory = Object.assign({ id: categoryId }, updatedDoc.data());
        console.log(`[updateCategory] Successfully updated category: ${categoryId}`);
        return {
            success: true,
            category: updatedCategory,
        };
    }
    catch (error) {
        console.error('[updateCategory] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
/**
 * Toggle category active status (Admin only)
 */
exports.toggleCategoryStatus = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user (admin only for toggling categories)
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.ADMIN);
        if (!user || !userData) {
            throw new Error('Admin authentication required');
        }
        const { categoryId, isActive } = request.data;
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        console.log(`[toggleCategoryStatus] Admin ${user.uid} setting category ${categoryId} to ${isActive ? 'active' : 'inactive'}`);
        // Update category status
        const categoryRef = db.collection('categories').doc(categoryId);
        await categoryRef.update({
            isActive,
            updatedAt: now,
        });
        // Return updated category
        const updatedDoc = await categoryRef.get();
        if (!updatedDoc.exists) {
            throw new Error('Category not found');
        }
        const updatedCategory = Object.assign({ id: categoryId }, updatedDoc.data());
        console.log(`[toggleCategoryStatus] Successfully toggled category status: ${categoryId}`);
        return {
            success: true,
            category: updatedCategory,
        };
    }
    catch (error) {
        console.error('[toggleCategoryStatus] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
/**
 * Get valid category IDs for validation purposes
 */
exports.getCategoryValidationList = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        const db = admin.firestore();
        // Get all active categories
        const snapshot = await db.collection('categories')
            .where('isActive', '==', true)
            .get();
        const categoryIds = [];
        snapshot.forEach((doc) => {
            categoryIds.push(doc.id);
        });
        console.log(`[getCategoryValidationList] Retrieved ${categoryIds.length} active category IDs for validation`);
        return {
            success: true,
            categoryIds,
        };
    }
    catch (error) {
        console.error('[getCategoryValidationList] Error:', error);
        return {
            success: false,
            categoryIds: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
//# sourceMappingURL=categoriesManagement.js.map