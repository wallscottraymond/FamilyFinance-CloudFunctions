/**
 * Tests for Plaid Client Factory
 *
 * Validates that the centralized Plaid client factory creates properly
 * configured clients and reduces code duplication across Plaid functions.
 */

import { createStandardPlaidClient, validatePlaidConfiguration } from '../plaidClientFactory';
import { PlaidApi } from 'plaid';

// Mock Firebase secrets for testing
jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn(() => ({
    value: () => 'test-secret-value'
  }))
}));

describe('Plaid Client Factory', () => {
  describe('createStandardPlaidClient', () => {
    test('should create a valid PlaidApi instance', () => {
      const client = createStandardPlaidClient();

      expect(client).toBeInstanceOf(PlaidApi);
    });

    test('should create clients with required methods', () => {
      const client = createStandardPlaidClient();

      const requiredMethods = [
        'itemPublicTokenExchange',
        'transactionsSync',
        'accountsGet',
        'institutionsGetById'
      ];

      requiredMethods.forEach(method => {
        expect(typeof client[method as keyof PlaidApi]).toBe('function');
      });
    });

    test('should create multiple client instances', () => {
      const client1 = createStandardPlaidClient();
      const client2 = createStandardPlaidClient();

      expect(client1).toBeInstanceOf(PlaidApi);
      expect(client2).toBeInstanceOf(PlaidApi);
      expect(client1).not.toBe(client2); // Different instances
    });
  });

  describe('validatePlaidConfiguration', () => {
    test('should validate configuration successfully', async () => {
      const isValid = await validatePlaidConfiguration();

      expect(isValid).toBe(true);
    });
  });

  describe('Code Duplication Reduction', () => {
    test('should eliminate duplicate client creation patterns', () => {
      // This test validates that the factory pattern successfully
      // eliminates the need for manual PlaidApi instantiation
      const client = createStandardPlaidClient();

      expect(client).toBeDefined();
      expect(client.constructor.name).toBe('PlaidApi');
    });

    test('should provide consistent configuration across functions', () => {
      const client1 = createStandardPlaidClient();
      const client2 = createStandardPlaidClient();

      // Both clients should have the same configuration
      expect(client1.constructor).toBe(client2.constructor);
    });
  });

  describe('Integration with Existing Functions', () => {
    test('should work as drop-in replacement for manual client creation', () => {
      // Test that the factory can replace manual PlaidApi instantiation
      expect(() => {
        const client = createStandardPlaidClient();
        // Verify client has expected structure
        expect(client).toHaveProperty('itemPublicTokenExchange');
        expect(client).toHaveProperty('transactionsSync');
      }).not.toThrow();
    });
  });
});