"use strict";
/**
 * Transactions Development/Testing Module
 *
 * Functions in this module are designed for local development and testing only.
 * They simulate production workflows using static test data to seed the local
 * Firestore emulator without making actual external API calls.
 *
 * DO NOT deploy these functions to production.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestTransactionsByCategory = exports.createTestTransactions = void 0;
var createTestTransactions_1 = require("./createTestTransactions");
Object.defineProperty(exports, "createTestTransactions", { enumerable: true, get: function () { return createTestTransactions_1.createTestTransactions; } });
var createTestTransactionsByCategory_1 = require("./createTestTransactionsByCategory");
Object.defineProperty(exports, "createTestTransactionsByCategory", { enumerable: true, get: function () { return createTestTransactionsByCategory_1.createTestTransactionsByCategory; } });
//# sourceMappingURL=index.js.map