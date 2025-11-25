/**
 * Categories Management Functions
 *
 * Provides CRUD operations for the categories collection to replace
 * hardcoded category mappings with dynamic database-driven approach.
 */
import { Category } from '../../types';
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
export declare const getCategories: import("firebase-functions/v2/https").CallableFunction<GetCategoriesRequest, Promise<GetCategoriesResponse>>;
/**
 * Add a new custom category (Admin only)
 */
export declare const addCategory: import("firebase-functions/v2/https").CallableFunction<AddCategoryRequest, Promise<CategoryResponse>>;
/**
 * Update an existing category (Admin only)
 */
export declare const updateCategory: import("firebase-functions/v2/https").CallableFunction<UpdateCategoryRequest, Promise<CategoryResponse>>;
/**
 * Toggle category active status (Admin only)
 */
export declare const toggleCategoryStatus: import("firebase-functions/v2/https").CallableFunction<ToggleCategoryRequest, Promise<CategoryResponse>>;
/**
 * Get valid category IDs for validation purposes
 */
export declare const getCategoryValidationList: import("firebase-functions/v2/https").CallableFunction<{}, Promise<{
    success: boolean;
    categoryIds: string[];
    error?: string;
}>>;
export {};
//# sourceMappingURL=categoriesManagement.d.ts.map