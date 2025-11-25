/**
 * Transactions Development/Testing Module
 *
 * Functions in this module are designed for local development and testing only.
 * They simulate production workflows using static test data to seed the local
 * Firestore emulator without making actual external API calls.
 *
 * DO NOT deploy these functions to production.
 */

export { createTestTransactions } from './createTestTransactions';
