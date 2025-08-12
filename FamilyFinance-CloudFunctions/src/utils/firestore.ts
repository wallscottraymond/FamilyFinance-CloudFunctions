import * as admin from "firebase-admin";
import { QueryOptions, WhereClause, BaseDocument } from "../types";

const db = admin.firestore();

/**
 * Generic function to create a document in Firestore
 */
export async function createDocument<T extends BaseDocument>(
  collection: string,
  data: Omit<T, "id" | "createdAt" | "updatedAt">,
  customId?: string
): Promise<T> {
  const now = admin.firestore.Timestamp.now();
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

  return {
    id: docRef.id,
    ...documentData,
  } as T;
}

/**
 * Generic function to get a document by ID
 */
export async function getDocument<T extends BaseDocument>(
  collection: string,
  id: string
): Promise<T | null> {
  const docRef = db.collection(collection).doc(id);
  const doc = await docRef.get();
  
  if (!doc.exists) {
    return null;
  }

  return {
    id: doc.id,
    ...doc.data(),
  } as T;
}

/**
 * Generic function to update a document
 */
export async function updateDocument<T extends BaseDocument>(
  collection: string,
  id: string,
  data: Partial<Omit<T, "id" | "createdAt" | "updatedAt">>
): Promise<T> {
  const docRef = db.collection(collection).doc(id);
  const updateData = {
    ...data,
    updatedAt: admin.firestore.Timestamp.now(),
  };

  await docRef.update(updateData);
  
  const updatedDoc = await docRef.get();
  return {
    id: updatedDoc.id,
    ...updatedDoc.data(),
  } as T;
}

/**
 * Generic function to delete a document
 */
export async function deleteDocument(
  collection: string,
  id: string
): Promise<void> {
  await db.collection(collection).doc(id).delete();
}

/**
 * Generic function to query documents with options
 */
export async function queryDocuments<T extends BaseDocument>(
  collection: string,
  options: QueryOptions = {}
): Promise<T[]> {
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

  // Apply offset
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
}

/**
 * Function to execute a transaction
 */
export async function executeTransaction<T>(
  callback: (transaction: admin.firestore.Transaction) => Promise<T>
): Promise<T> {
  return db.runTransaction(callback);
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
  const batch = db.batch();

  operations.forEach(operation => {
    const { type, collection, id, data } = operation;
    
    switch (type) {
    case "create":
      if (id) {
        const docRef = db.collection(collection).doc(id);
        batch.set(docRef, {
          ...data,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
      } else {
        const docRef = db.collection(collection).doc();
        batch.set(docRef, {
          ...data,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }
      break;
    case "update":
      if (!id) throw new Error("ID required for update operation");
      const updateRef = db.collection(collection).doc(id);
      batch.update(updateRef, {
        ...data,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      break;
    case "delete":
      if (!id) throw new Error("ID required for delete operation");
      const deleteRef = db.collection(collection).doc(id);
      batch.delete(deleteRef);
      break;
    }
  });

  await batch.commit();
}

/**
 * Function to get a document with subcollections
 */
export async function getDocumentWithSubcollections<T extends BaseDocument>(
  collection: string,
  id: string,
  subcollections: string[]
): Promise<T & Record<string, any[]> | null> {
  const doc = await getDocument<T>(collection, id);
  if (!doc) return null;

  const subcollectionData: Record<string, any[]> = {};
  
  for (const subcollection of subcollections) {
    const subDocs = await queryDocuments(`${collection}/${id}/${subcollection}`);
    subcollectionData[subcollection] = subDocs;
  }

  return {
    ...doc,
    ...subcollectionData,
  };
}

/**
 * Function to listen to document changes
 */
export function listenToDocument<T extends BaseDocument>(
  collection: string,
  id: string,
  callback: (doc: T | null) => void
): () => void {
  const docRef = db.collection(collection).doc(id);
  
  return docRef.onSnapshot(doc => {
    if (doc.exists) {
      callback({
        id: doc.id,
        ...doc.data(),
      } as T);
    } else {
      callback(null);
    }
  });
}

/**
 * Function to listen to collection changes
 */
export function listenToCollection<T extends BaseDocument>(
  collection: string,
  options: QueryOptions,
  callback: (docs: T[]) => void
): () => void {
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

  return query.onSnapshot(snapshot => {
    const docs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as T[];
    callback(docs);
  });
}

/**
 * Function to check if a document exists
 */
export async function documentExists(
  collection: string,
  id: string
): Promise<boolean> {
  const doc = await db.collection(collection).doc(id).get();
  return doc.exists;
}

/**
 * Function to get document count
 */
export async function getDocumentCount(
  collection: string,
  options: QueryOptions = {}
): Promise<number> {
  let query: admin.firestore.Query = db.collection(collection);

  // Apply where clauses
  if (options.where) {
    options.where.forEach((whereClause: WhereClause) => {
      query = query.where(whereClause.field, whereClause.operator, whereClause.value);
    });
  }

  const snapshot = await query.get();
  return snapshot.size;
}