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
 * Generic function to create a document in Firestore
 */
async function createDocument(collection, data, customId) {
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
    return Object.assign({ id: docRef.id }, documentData);
}
/**
 * Generic function to get a document by ID
 */
async function getDocument(collection, id) {
    const docRef = db.collection(collection).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
        return null;
    }
    return Object.assign({ id: doc.id }, doc.data());
}
/**
 * Generic function to update a document
 */
async function updateDocument(collection, id, data) {
    const docRef = db.collection(collection).doc(id);
    const updateData = Object.assign(Object.assign({}, data), { updatedAt: firestore_1.Timestamp.now() });
    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return Object.assign({ id: updatedDoc.id }, updatedDoc.data());
}
/**
 * Generic function to delete a document
 */
async function deleteDocument(collection, id) {
    await db.collection(collection).doc(id).delete();
}
/**
 * Generic function to query documents with options
 */
async function queryDocuments(collection, options = {}) {
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
    // Apply offset
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
/**
 * Function to execute a transaction
 */
async function executeTransaction(callback) {
    return db.runTransaction(callback);
}
/**
 * Function to execute a batch write
 */
async function executeBatch(operations) {
    const batch = db.batch();
    operations.forEach(operation => {
        const { type, collection, id, data } = operation;
        switch (type) {
            case "create":
                if (id) {
                    const docRef = db.collection(collection).doc(id);
                    batch.set(docRef, Object.assign(Object.assign({}, data), { createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() }));
                }
                else {
                    const docRef = db.collection(collection).doc();
                    batch.set(docRef, Object.assign(Object.assign({}, data), { createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() }));
                }
                break;
            case "update":
                if (!id)
                    throw new Error("ID required for update operation");
                const updateRef = db.collection(collection).doc(id);
                batch.update(updateRef, Object.assign(Object.assign({}, data), { updatedAt: firestore_1.Timestamp.now() }));
                break;
            case "delete":
                if (!id)
                    throw new Error("ID required for delete operation");
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
async function getDocumentWithSubcollections(collection, id, subcollections) {
    const doc = await getDocument(collection, id);
    if (!doc)
        return null;
    const subcollectionData = {};
    for (const subcollection of subcollections) {
        const subDocs = await queryDocuments(`${collection}/${id}/${subcollection}`);
        subcollectionData[subcollection] = subDocs;
    }
    return Object.assign(Object.assign({}, doc), subcollectionData);
}
/**
 * Function to listen to document changes
 */
function listenToDocument(collection, id, callback) {
    const docRef = db.collection(collection).doc(id);
    return docRef.onSnapshot(doc => {
        if (doc.exists) {
            callback(Object.assign({ id: doc.id }, doc.data()));
        }
        else {
            callback(null);
        }
    });
}
/**
 * Function to listen to collection changes
 */
function listenToCollection(collection, options, callback) {
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
    return query.onSnapshot(snapshot => {
        const docs = snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        callback(docs);
    });
}
/**
 * Function to check if a document exists
 */
async function documentExists(collection, id) {
    const doc = await db.collection(collection).doc(id).get();
    return doc.exists;
}
/**
 * Function to get document count
 */
async function getDocumentCount(collection, options = {}) {
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
//# sourceMappingURL=firestore.js.map