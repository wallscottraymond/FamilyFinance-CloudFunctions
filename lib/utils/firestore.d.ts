import * as admin from "firebase-admin";
import { QueryOptions, BaseDocument } from "../types";
/**
 * Generic function to create a document in Firestore
 */
export declare function createDocument<T extends BaseDocument>(collection: string, data: Omit<T, "id" | "createdAt" | "updatedAt">, customId?: string): Promise<T>;
/**
 * Generic function to get a document by ID
 */
export declare function getDocument<T extends BaseDocument>(collection: string, id: string): Promise<T | null>;
/**
 * Generic function to update a document
 */
export declare function updateDocument<T extends BaseDocument>(collection: string, id: string, data: Partial<Omit<T, "id" | "createdAt" | "updatedAt">>): Promise<T>;
/**
 * Generic function to delete a document
 */
export declare function deleteDocument(collection: string, id: string): Promise<void>;
/**
 * Generic function to query documents with options
 */
export declare function queryDocuments<T extends BaseDocument>(collection: string, options?: QueryOptions): Promise<T[]>;
/**
 * Function to execute a transaction
 */
export declare function executeTransaction<T>(callback: (transaction: admin.firestore.Transaction) => Promise<T>): Promise<T>;
/**
 * Function to execute a batch write
 */
export declare function executeBatch(operations: Array<{
    type: "create" | "update" | "delete";
    collection: string;
    id?: string;
    data?: any;
}>): Promise<void>;
/**
 * Function to get a document with subcollections
 */
export declare function getDocumentWithSubcollections<T extends BaseDocument>(collection: string, id: string, subcollections: string[]): Promise<T & Record<string, any[]> | null>;
/**
 * Function to listen to document changes
 */
export declare function listenToDocument<T extends BaseDocument>(collection: string, id: string, callback: (doc: T | null) => void): () => void;
/**
 * Function to listen to collection changes
 */
export declare function listenToCollection<T extends BaseDocument>(collection: string, options: QueryOptions, callback: (docs: T[]) => void): () => void;
/**
 * Function to check if a document exists
 */
export declare function documentExists(collection: string, id: string): Promise<boolean>;
/**
 * Function to get document count
 */
export declare function getDocumentCount(collection: string, options?: QueryOptions): Promise<number>;
//# sourceMappingURL=firestore.d.ts.map