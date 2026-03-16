import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { QueryOptions, WhereClause, BaseDocument } from "../types";

const db = admin.firestore();

/**
 * Validates collection name
 */
function validateCollectionName(collection: string): void {
  if (!collection || typeof collection !== 'string' || collection.trim().length === 0) {
    throw new Error('Invalid collection name: must be a non-empty string');
  }
}

/**
 * Validates document ID
 */
function validateDocumentId(id: string): void {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Invalid document ID: must be a non-empty string');
  }
}

/**
 * Generic function to create a document in Firestore
 */
export async function createDocument<T extends BaseDocument>(
  collection: string,
  data: Omit<T, "id" | "createdAt" | "updatedAt">,
  customId?: string
): Promise<T> {
  try {
    validateCollectionName(collection);
    if (customId) {
      validateDocumentId(customId);
    }

    const now = Timestamp.now();
    const documentData = {
      ...data,
      createdAt: now,
      updatedAt: now,
    } as Omit<T, "id">;

    let docRef: admin.firestore.DocumentReference;

    if (customId) {
      docRef = db.collection(collection).doc(customId);
      await docRef.set(documentData);
    } else {
      docRef = await db.collection(collection).add(documentData);
    }

    console.log(`[createDocument] Document created in ${collection}: ${docRef.id}`);

    return {
      id: docRef.id,
      ...documentData,
    } as T;
  } catch (error) {
    console.error(`[createDocument] Error creating document in ${collection}:`, error);
    throw new Error(
      `Failed to create document in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Generic function to get a document by ID
 */
export async function getDocument<T extends BaseDocument>(
  collection: string,
  id: string
): Promise<T | null> {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    const docRef = db.collection(collection).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as T;
  } catch (error) {
    console.error(`[getDocument] Error getting document ${id} from ${collection}:`, error);
    throw new Error(
      `Failed to get document ${id} from ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Generic function to update a document
 */
export async function updateDocument<T extends BaseDocument>(
  collection: string,
  id: string,
  data: Partial<Omit<T, "id" | "createdAt" | "updatedAt">>
): Promise<T> {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    if (!data || Object.keys(data).length === 0) {
      throw new Error('Update data cannot be empty');
    }

    const docRef = db.collection(collection).doc(id);

    // Check if document exists before updating
    const existingDoc = await docRef.get();
    if (!existingDoc.exists) {
      throw new Error(`Document ${id} not found in ${collection}`);
    }

    const updateData = {
      ...data,
      updatedAt: Timestamp.now(),
    };

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();

    console.log(`[updateDocument] Document ${id} updated in ${collection}`);

    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as T;
  } catch (error) {
    console.error(`[updateDocument] Error updating document ${id} in ${collection}:`, error);
    throw new Error(
      `Failed to update document ${id} in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Generic function to delete a document
 */
export async function deleteDocument(
  collection: string,
  id: string
): Promise<void> {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    const docRef = db.collection(collection).doc(id);

    // Check if document exists before deleting
    const existingDoc = await docRef.get();
    if (!existingDoc.exists) {
      console.warn(`[deleteDocument] Document ${id} not found in ${collection}, skipping delete`);
      return;
    }

    await docRef.delete();

    console.log(`[deleteDocument] Document ${id} deleted from ${collection}`);
  } catch (error) {
    console.error(`[deleteDocument] Error deleting document ${id} from ${collection}:`, error);
    throw new Error(
      `Failed to delete document ${id} from ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Generic function to query documents with options
 */
export async function queryDocuments<T extends BaseDocument>(
  collection: string,
  options: QueryOptions = {}
): Promise<T[]> {
  try {
    validateCollectionName(collection);

    let query: admin.firestore.Query = db.collection(collection);

    // Apply where clauses
    if (options.where) {
      options.where.forEach((whereClause: WhereClause) => {
        if (!whereClause.field || whereClause.value === undefined) {
          throw new Error('Invalid where clause: field and value are required');
        }
        query = query.where(whereClause.field, whereClause.operator, whereClause.value);
      });
    }

    // Apply ordering
    if (options.orderBy) {
      query = query.orderBy(options.orderBy, options.orderDirection || "asc");
    }

    // Apply offset (note: offset can be slow for large datasets, prefer cursor pagination)
    if (options.offset) {
      query = query.offset(options.offset);
    }

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as T[];
  } catch (error) {
    console.error(`[queryDocuments] Error querying ${collection}:`, error);
    throw new Error(
      `Failed to query ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to execute a transaction
 */
export async function executeTransaction<T>(
  callback: (transaction: admin.firestore.Transaction) => Promise<T>
): Promise<T> {
  try {
    return await db.runTransaction(callback);
  } catch (error) {
    console.error('[executeTransaction] Transaction failed:', error);
    throw new Error(
      `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to execute a batch write
 */
export async function executeBatch(
  operations: Array<{
    type: "create" | "update" | "delete";
    collection: string;
    id?: string;
    data?: any;
  }>
): Promise<void> {
  try {
    if (!operations || operations.length === 0) {
      console.warn('[executeBatch] No operations provided, skipping batch');
      return;
    }

    if (operations.length > 500) {
      throw new Error('Batch operations cannot exceed 500 documents');
    }

    const batch = db.batch();

    operations.forEach((operation, index) => {
      const { type, collection, id, data } = operation;

      validateCollectionName(collection);

      switch (type) {
      case "create":
        if (id) {
          validateDocumentId(id);
          const docRef = db.collection(collection).doc(id);
          batch.set(docRef, {
            ...data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        } else {
          const docRef = db.collection(collection).doc();
          batch.set(docRef, {
            ...data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
        break;
      case "update":
        if (!id) {
          throw new Error(`ID required for update operation at index ${index}`);
        }
        validateDocumentId(id);
        const updateRef = db.collection(collection).doc(id);
        batch.update(updateRef, {
          ...data,
          updatedAt: Timestamp.now(),
        });
        break;
      case "delete":
        if (!id) {
          throw new Error(`ID required for delete operation at index ${index}`);
        }
        validateDocumentId(id);
        const deleteRef = db.collection(collection).doc(id);
        batch.delete(deleteRef);
        break;
      default:
        throw new Error(`Unknown operation type: ${type} at index ${index}`);
      }
    });

    await batch.commit();

    console.log(`[executeBatch] Successfully executed ${operations.length} batch operations`);
  } catch (error) {
    console.error('[executeBatch] Batch operation failed:', error);
    throw new Error(
      `Batch operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to get a document with subcollections
 */
export async function getDocumentWithSubcollections<T extends BaseDocument>(
  collection: string,
  id: string,
  subcollections: string[]
): Promise<T & Record<string, any[]> | null> {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    if (!subcollections || subcollections.length === 0) {
      throw new Error('At least one subcollection name is required');
    }

    const doc = await getDocument<T>(collection, id);
    if (!doc) return null;

    const subcollectionData: Record<string, any[]> = {};

    for (const subcollection of subcollections) {
      if (!subcollection || typeof subcollection !== 'string') {
        console.warn(`[getDocumentWithSubcollections] Invalid subcollection name, skipping`);
        continue;
      }
      const subDocs = await queryDocuments(`${collection}/${id}/${subcollection}`);
      subcollectionData[subcollection] = subDocs;
    }

    return {
      ...doc,
      ...subcollectionData,
    };
  } catch (error) {
    console.error(`[getDocumentWithSubcollections] Error getting document ${id} with subcollections:`, error);
    throw new Error(
      `Failed to get document with subcollections: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to listen to document changes
 * IMPORTANT: Caller must store and call the returned unsubscribe function to prevent memory leaks
 */
export function listenToDocument<T extends BaseDocument>(
  collection: string,
  id: string,
  callback: (doc: T | null) => void,
  onError?: (error: Error) => void
): () => void {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    const docRef = db.collection(collection).doc(id);

    const unsubscribe = docRef.onSnapshot(
      doc => {
        if (doc.exists) {
          callback({
            id: doc.id,
            ...doc.data(),
          } as T);
        } else {
          callback(null);
        }
      },
      error => {
        console.error(`[listenToDocument] Listener error for ${collection}/${id}:`, error);
        if (onError) {
          onError(error);
        }
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error(`[listenToDocument] Error setting up listener for ${collection}/${id}:`, error);
    throw new Error(
      `Failed to set up document listener: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to listen to collection changes
 * IMPORTANT: Caller must store and call the returned unsubscribe function to prevent memory leaks
 */
export function listenToCollection<T extends BaseDocument>(
  collection: string,
  options: QueryOptions,
  callback: (docs: T[]) => void,
  onError?: (error: Error) => void
): () => void {
  try {
    validateCollectionName(collection);

    let query: admin.firestore.Query = db.collection(collection);

    // Apply where clauses
    if (options.where) {
      options.where.forEach((whereClause: WhereClause) => {
        query = query.where(whereClause.field, whereClause.operator, whereClause.value);
      });
    }

    // Apply ordering
    if (options.orderBy) {
      query = query.orderBy(options.orderBy, options.orderDirection || "asc");
    }

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const unsubscribe = query.onSnapshot(
      snapshot => {
        const docs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        callback(docs);
      },
      error => {
        console.error(`[listenToCollection] Listener error for ${collection}:`, error);
        if (onError) {
          onError(error);
        }
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error(`[listenToCollection] Error setting up listener for ${collection}:`, error);
    throw new Error(
      `Failed to set up collection listener: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to check if a document exists
 */
export async function documentExists(
  collection: string,
  id: string
): Promise<boolean> {
  try {
    validateCollectionName(collection);
    validateDocumentId(id);

    const doc = await db.collection(collection).doc(id).get();
    return doc.exists;
  } catch (error) {
    console.error(`[documentExists] Error checking if document ${id} exists in ${collection}:`, error);
    throw new Error(
      `Failed to check document existence: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Function to get document count
 */
export async function getDocumentCount(
  collection: string,
  options: QueryOptions = {}
): Promise<number> {
  try {
    validateCollectionName(collection);

    let query: admin.firestore.Query = db.collection(collection);

    // Apply where clauses
    if (options.where) {
      options.where.forEach((whereClause: WhereClause) => {
        query = query.where(whereClause.field, whereClause.operator, whereClause.value);
      });
    }

    const snapshot = await query.get();
    return snapshot.size;
  } catch (error) {
    console.error(`[getDocumentCount] Error counting documents in ${collection}:`, error);
    throw new Error(
      `Failed to count documents in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
