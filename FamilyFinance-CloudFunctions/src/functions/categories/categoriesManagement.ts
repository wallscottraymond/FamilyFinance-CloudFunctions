/**
 * Categories Management Functions
 * 
 * Provides CRUD operations for the categories collection to replace
 * hardcoded category mappings with dynamic database-driven approach.
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { 
  Category,
  UserRole
} from '../../types';
import { authenticateRequest } from '../../utils/auth';

interface GetCategoriesRequest {
  type?: 'Income' | 'Outflow' | 'All';
  activeOnly?: boolean;
  budgetSelectionOnly?: boolean;
}

interface GetCategoriesResponse {
  success: boolean;
  categories: Category[];
  error?: string;
}

interface AddCategoryRequest {
  name: string;
  description: string;
  type: 'Income' | 'Outflow';
  primary_plaid_category: string;
  detailed_plaid_category: string;
  second_category: string;
  first_category: string;
  overall_category: string;
  visible_by_default: boolean;
  budget_selection: boolean;
  income_selection: boolean;
  transactionCategoryId?: string;
}

interface CategoryResponse {
  success: boolean;
  category?: Category;
  error?: string;
}

interface UpdateCategoryRequest {
  categoryId: string;
  updates: Partial<Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'isSystemCategory'>>;
}

interface ToggleCategoryRequest {
  categoryId: string;
  isActive: boolean;
}

/**
 * Get categories with filtering options
 */
export const getCategories = onCall<GetCategoriesRequest, Promise<GetCategoriesResponse>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<GetCategoriesRequest>) => {
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
    let query = db.collection('categories') as admin.firestore.Query;
    
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
    
    const categories: Category[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      categories.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt || admin.firestore.Timestamp.now(),
        updatedAt: data.updatedAt || admin.firestore.Timestamp.now(),
        isActive: data.isActive !== undefined ? data.isActive : true,
        isSystemCategory: data.isSystemCategory !== undefined ? data.isSystemCategory : true,
      } as Category);
    });
    
    console.log(`[getCategories] Retrieved ${categories.length} categories`);
    
    return {
      success: true,
      categories,
    };
    
  } catch (error) {
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
export const addCategory = onCall<AddCategoryRequest, Promise<CategoryResponse>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<AddCategoryRequest>) => {
  try {
    // Authenticate user (admin only for adding categories)
    const { user, userData } = await authenticateRequest(request, UserRole.ADMIN);
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
    const category: Omit<Category, 'id'> = {
      ...categoryData,
      index: nextIndex,
      isActive: true,
      isSystemCategory: false, // Custom categories are not system categories
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };
    
    const docRef = await db.collection('categories').add(category);
    
    const createdCategory: Category = {
      id: docRef.id,
      ...category,
    };
    
    console.log(`[addCategory] Successfully created category: ${docRef.id}`);
    
    return {
      success: true,
      category: createdCategory,
    };
    
  } catch (error) {
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
export const updateCategory = onCall<UpdateCategoryRequest, Promise<CategoryResponse>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<UpdateCategoryRequest>) => {
  try {
    // Authenticate user (admin only for updating categories)
    const { user, userData } = await authenticateRequest(request, UserRole.ADMIN);
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
    
    const existingCategory = categoryDoc.data() as Category;
    
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
    const updateData = {
      ...updates,
      updatedAt: now,
    };
    
    await categoryRef.update(updateData);
    
    // Return updated category
    const updatedDoc = await categoryRef.get();
    const updatedCategory: Category = {
      id: categoryId,
      ...updatedDoc.data() as Omit<Category, 'id'>,
    };
    
    console.log(`[updateCategory] Successfully updated category: ${categoryId}`);
    
    return {
      success: true,
      category: updatedCategory,
    };
    
  } catch (error) {
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
export const toggleCategoryStatus = onCall<ToggleCategoryRequest, Promise<CategoryResponse>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<ToggleCategoryRequest>) => {
  try {
    // Authenticate user (admin only for toggling categories)
    const { user, userData } = await authenticateRequest(request, UserRole.ADMIN);
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
    
    const updatedCategory: Category = {
      id: categoryId,
      ...updatedDoc.data() as Omit<Category, 'id'>,
    };
    
    console.log(`[toggleCategoryStatus] Successfully toggled category status: ${categoryId}`);
    
    return {
      success: true,
      category: updatedCategory,
    };
    
  } catch (error) {
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
export const getCategoryValidationList = onCall<{}, Promise<{ success: boolean; categoryIds: string[]; error?: string }>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<{}>) => {
  try {
    const db = admin.firestore();
    
    // Get all active categories
    const snapshot = await db.collection('categories')
      .where('isActive', '==', true)
      .get();
    
    const categoryIds: string[] = [];
    snapshot.forEach((doc) => {
      categoryIds.push(doc.id);
    });
    
    console.log(`[getCategoryValidationList] Retrieved ${categoryIds.length} active category IDs for validation`);
    
    return {
      success: true,
      categoryIds,
    };
    
  } catch (error) {
    console.error('[getCategoryValidationList] Error:', error);
    return {
      success: false,
      categoryIds: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});