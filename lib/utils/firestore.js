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
exports.createDocument = createDocument;
exports.getDocument = getDocument;
exports.updateDocument = updateDocument;
exports.deleteDocument = deleteDocument;
exports.queryDocuments = queryDocuments;
exports.executeTransaction = executeTransaction;
exports.executeBatch = executeBatch;
exports.getDocumentWithSubcollections = getDocumentWithSubcollections;
exports.listenToDocument = listenToDocument;
exports.listenToCollection = listenToCollection;
exports.documentExists = documentExists;
exports.getDocumentCount = getDocumentCount;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const db = admin.firestore();
/**
 * Validates collection name
 */
function validateCollectionName(collection) {
    if (!collection || typeof collection !== 'string' || collection.trim().length === 0) {
        throw new Error('Invalid collection name: must be a non-empty string');
    }
}
/**
 * Validates document ID
 */
function validateDocumentId(id) {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Invalid document ID: must be a non-empty string');
    }
}
/**
 * Generic function to create a document in Firestore
 */
async function createDocument(collection, data, customId) {
    try {
        validateCollectionName(collection);
        if (customId) {
            validateDocumentId(customId);
        }
        const now = firestore_1.Timestamp.now();
        const documentData = Object.assign(Object.assign({}, data), { createdAt: now, updatedAt: now });
        let docRef;
        if (customId) {
            docRef = db.collection(collection).doc(customId);
            await docRef.set(documentData);
        }
        else {
            docRef = await db.collection(collection).add(documentData);
        }
        console.log(`[createDocument] Document created in ${collection}: ${docRef.id}`);
        return Object.assign({ id: docRef.id }, documentData);
    }
    catch (error) {
        console.error(`[createDocument] Error creating document in ${collection}:`, error);
        throw new Error(`Failed to create document in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Generic function to get a document by ID
 */
async function getDocument(collection, id) {
    try {
        validateCollectionName(collection);
        validateDocumentId(id);
        const docRef = db.collection(collection).doc(id);
        const doc = await docRef.get();
        if (!doc.exists) {
            return null;
        }
        return Object.assign({ id: doc.id }, doc.data());
    }
    catch (error) {
        console.error(`[getDocument] Error getting document ${id} from ${collection}:`, error);
        throw new Error(`Failed to get document ${id} from ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Generic function to update a document
 */
async function updateDocument(collection, id, data) {
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
        const updateData = Object.assign(Object.assign({}, data), { updatedAt: firestore_1.Timestamp.now() });
        await docRef.update(updateData);
        const updatedDoc = await docRef.get();
        console.log(`[updateDocument] Document ${id} updated in ${collection}`);
        return Object.assign({ id: updatedDoc.id }, updatedDoc.data());
    }
    catch (error) {
        console.error(`[updateDocument] Error updating document ${id} in ${collection}:`, error);
        throw new Error(`Failed to update document ${id} in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Generic function to delete a document
 */
async function deleteDocument(collection, id) {
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
    }
    catch (error) {
        console.error(`[deleteDocument] Error deleting document ${id} from ${collection}:`, error);
        throw new Error(`Failed to delete document ${id} from ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Generic function to query documents with options
 */
async function queryDocuments(collection, options = {}) {
    try {
        validateCollectionName(collection);
        let query = db.collection(collection);
        // Apply where clauses
        if (options.where) {
            options.where.forEach((whereClause) => {
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
        return snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
    }
    catch (error) {
        console.error(`[queryDocuments] Error querying ${collection}:`, error);
        throw new Error(`Failed to query ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to execute a transaction
 */
async function executeTransaction(callback) {
    try {
        return await db.runTransaction(callback);
    }
    catch (error) {
        console.error('[executeTransaction] Transaction failed:', error);
        throw new Error(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to execute a batch write
 */
async function executeBatch(operations) {
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
                        batch.set(docRef, Object.assign(Object.assign({}, data), { createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() }));
                    }
                    else {
                        const docRef = db.collection(collection).doc();
                        batch.set(docRef, Object.assign(Object.assign({}, data), { createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() }));
                    }
                    break;
                case "update":
                    if (!id) {
                        throw new Error(`ID required for update operation at index ${index}`);
                    }
                    validateDocumentId(id);
                    const updateRef = db.collection(collection).doc(id);
                    batch.update(updateRef, Object.assign(Object.assign({}, data), { updatedAt: firestore_1.Timestamp.now() }));
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
    }
    catch (error) {
        console.error('[executeBatch] Batch operation failed:', error);
        throw new Error(`Batch operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to get a document with subcollections
 */
async function getDocumentWithSubcollections(collection, id, subcollections) {
    try {
        validateCollectionName(collection);
        validateDocumentId(id);
        if (!subcollections || subcollections.length === 0) {
            throw new Error('At least one subcollection name is required');
        }
        const doc = await getDocument(collection, id);
        if (!doc)
            return null;
        const subcollectionData = {};
        for (const subcollection of subcollections) {
            if (!subcollection || typeof subcollection !== 'string') {
                console.warn(`[getDocumentWithSubcollections] Invalid subcollection name, skipping`);
                continue;
            }
            const subDocs = await queryDocuments(`${collection}/${id}/${subcollection}`);
            subcollectionData[subcollection] = subDocs;
        }
        return Object.assign(Object.assign({}, doc), subcollectionData);
    }
    catch (error) {
        console.error(`[getDocumentWithSubcollections] Error getting document ${id} with subcollections:`, error);
        throw new Error(`Failed to get document with subcollections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to listen to document changes
 * IMPORTANT: Caller must store and call the returned unsubscribe function to prevent memory leaks
 */
function listenToDocument(collection, id, callback, onError) {
    try {
        validateCollectionName(collection);
        validateDocumentId(id);
        const docRef = db.collection(collection).doc(id);
        const unsubscribe = docRef.onSnapshot(doc => {
            if (doc.exists) {
                callback(Object.assign({ id: doc.id }, doc.data()));
            }
            else {
                callback(null);
            }
        }, error => {
            console.error(`[listenToDocument] Listener error for ${collection}/${id}:`, error);
            if (onError) {
                onError(error);
            }
        });
        return unsubscribe;
    }
    catch (error) {
        console.error(`[listenToDocument] Error setting up listener for ${collection}/${id}:`, error);
        throw new Error(`Failed to set up document listener: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to listen to collection changes
 * IMPORTANT: Caller must store and call the returned unsubscribe function to prevent memory leaks
 */
function listenToCollection(collection, options, callback, onError) {
    try {
        validateCollectionName(collection);
        let query = db.collection(collection);
        // Apply where clauses
        if (options.where) {
            options.where.forEach((whereClause) => {
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
        const unsubscribe = query.onSnapshot(snapshot => {
            const docs = snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
            callback(docs);
        }, error => {
            console.error(`[listenToCollection] Listener error for ${collection}:`, error);
            if (onError) {
                onError(error);
            }
        });
        return unsubscribe;
    }
    catch (error) {
        console.error(`[listenToCollection] Error setting up listener for ${collection}:`, error);
        throw new Error(`Failed to set up collection listener: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to check if a document exists
 */
async function documentExists(collection, id) {
    try {
        validateCollectionName(collection);
        validateDocumentId(id);
        const doc = await db.collection(collection).doc(id).get();
        return doc.exists;
    }
    catch (error) {
        console.error(`[documentExists] Error checking if document ${id} exists in ${collection}:`, error);
        throw new Error(`Failed to check document existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Function to get document count
 */
async function getDocumentCount(collection, options = {}) {
    try {
        validateCollectionName(collection);
        let query = db.collection(collection);
        // Apply where clauses
        if (options.where) {
            options.where.forEach((whereClause) => {
                query = query.where(whereClause.field, whereClause.operator, whereClause.value);
            });
        }
        const snapshot = await query.get();
        return snapshot.size;
    }
    catch (error) {
        console.error(`[getDocumentCount] Error counting documents in ${collection}:`, error);
        throw new Error(`Failed to count documents in ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
//# sourceMappingURL=firestore.js.map