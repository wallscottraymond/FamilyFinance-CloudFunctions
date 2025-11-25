/**
 * Integration tests for Plaid v38.1.0 compatibility
 *
 * Tests to validate that the Plaid upgrade from v11.0.0 to v38.1.0
 * doesn't break existing functionality.
 */

import { PlaidApi, Configuration, PlaidEnvironments, TransactionsUpdateStatus } from 'plaid';
import { createPlaidClient, exchangePublicToken } from '../../../utils/plaidClient';

describe('Plaid v38.1.0 Integration Tests', () => {
  const TEST_CLIENT_ID = 'test-client-id';
  const TEST_SECRET = 'test-secret';

  describe('Plaid Client Creation', () => {
    test('should create PlaidApi client successfully', () => {
      const client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);

      expect(client).toBeInstanceOf(PlaidApi);
      // Configuration is now protected, but we can still test that the client was created
      expect(client.itemPublicTokenExchange).toBeDefined();
    });

    test('should create client without errors', () => {
      expect(() => {
        const client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);
        expect(client).toBeDefined();
      }).not.toThrow();
    });

    test('should handle empty credentials gracefully', () => {
      // The new Plaid client doesn't throw on empty credentials during creation
      expect(() => {
        createPlaidClient('', '');
      }).not.toThrow();
    });
  });

  describe('Plaid API Methods Compatibility', () => {
    let client: PlaidApi;

    beforeEach(() => {
      client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);
    });

    test('should have itemPublicTokenExchange method', () => {
      expect(typeof client.itemPublicTokenExchange).toBe('function');
    });

    test('should have transactionsSync method', () => {
      expect(typeof client.transactionsSync).toBe('function');
    });

    test('should have accountsGet method', () => {
      expect(typeof client.accountsGet).toBe('function');
    });

    test('should have institutionsGetById method', () => {
      expect(typeof client.institutionsGetById).toBe('function');
    });

    test('should have itemGet method', () => {
      expect(typeof client.itemGet).toBe('function');
    });

    test('should have transactionsRecurringGet method', () => {
      expect(typeof client.transactionsRecurringGet).toBe('function');
    });
  });

  describe('API Request Structure Compatibility', () => {
    let client: PlaidApi;

    beforeEach(() => {
      client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);
    });

    test('should handle itemPublicTokenExchange request format', async () => {
      // Mock the API call to avoid making real requests
      const mockExchange = jest.spyOn(client, 'itemPublicTokenExchange').mockResolvedValue({
        data: {
          access_token: 'test-access-token',
          item_id: 'test-item-id',
          request_id: 'test-request-id'
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any
      });

      const result = await exchangePublicToken(client, 'test-public-token');

      expect(mockExchange).toHaveBeenCalledWith({
        public_token: 'test-public-token'
      });
      expect(result).toEqual({
        accessToken: 'test-access-token',
        itemId: 'test-item-id'
      });

      mockExchange.mockRestore();
    });

    test('should handle transactionsSync request format', async () => {
      const mockSync = jest.spyOn(client, 'transactionsSync').mockResolvedValue({
        data: {
          added: [],
          modified: [],
          removed: [],
          next_cursor: 'test-cursor',
          has_more: false,
          request_id: 'test-request-id',
          transactions_update_status: TransactionsUpdateStatus.HistoricalUpdateComplete,
          accounts: []
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any
      });

      await client.transactionsSync({
        access_token: 'test-access-token'
      });

      expect(mockSync).toHaveBeenCalledWith({
        access_token: 'test-access-token'
      });

      mockSync.mockRestore();
    });

    test('should handle accountsGet request format', async () => {
      const mockAccounts = jest.spyOn(client, 'accountsGet').mockResolvedValue({
        data: {
          accounts: [],
          item: {
            item_id: 'test-item-id',
            institution_id: 'test-institution-id',
            webhook: null,
            error: null,
            available_products: [],
            billed_products: [],
            products: [],
            consented_products: [],
            update_type: 'background' as any,
            consent_expiration_time: null
          },
          request_id: 'test-request-id'
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any
      });

      await client.accountsGet({
        access_token: 'test-access-token'
      });

      expect(mockAccounts).toHaveBeenCalledWith({
        access_token: 'test-access-token'
      });

      mockAccounts.mockRestore();
    });
  });

  describe('Error Handling Compatibility', () => {
    let client: PlaidApi;

    beforeEach(() => {
      client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);
    });

    test('should handle API errors correctly', async () => {
      const mockError = {
        response: {
          data: {
            error_code: 'INVALID_ACCESS_TOKEN',
            error_message: 'Invalid access token',
            error_type: 'INVALID_INPUT'
          },
          status: 400
        }
      };

      const mockExchange = jest.spyOn(client, 'itemPublicTokenExchange').mockRejectedValue(mockError);

      await expect(exchangePublicToken(client, 'invalid-token')).rejects.toThrow('Token exchange failed');

      mockExchange.mockRestore();
    });
  });

  describe('Environment Configuration', () => {
    test('should support sandbox environment', () => {
      const config = new Configuration({
        basePath: PlaidEnvironments.sandbox
      });

      expect(config.basePath).toBe(PlaidEnvironments.sandbox);
    });

    test('should support production environment', () => {
      const config = new Configuration({
        basePath: PlaidEnvironments.production
      });

      expect(config.basePath).toBe(PlaidEnvironments.production);
    });

    test('should support configurable environments', () => {
      // Test that Configuration can be created with different base paths
      const sandboxConfig = new Configuration({
        basePath: PlaidEnvironments.sandbox
      });
      const prodConfig = new Configuration({
        basePath: PlaidEnvironments.production
      });

      expect(sandboxConfig.basePath).toBe(PlaidEnvironments.sandbox);
      expect(prodConfig.basePath).toBe(PlaidEnvironments.production);
    });
  });

  describe('Type Safety Validation', () => {
    test('should have proper TypeScript types for PlaidApi', () => {
      const client = createPlaidClient(TEST_CLIENT_ID, TEST_SECRET);

      // These should compile without TypeScript errors
      expect(client.itemPublicTokenExchange).toBeDefined();
      expect(client.transactionsSync).toBeDefined();
      expect(client.accountsGet).toBeDefined();
    });

    test('should have proper types for PlaidEnvironments', () => {
      // These should be string literals
      expect(typeof PlaidEnvironments.sandbox).toBe('string');
      expect(typeof PlaidEnvironments.production).toBe('string');
      // Development environment may not be available in newer versions
      expect(PlaidEnvironments.sandbox).toBeDefined();
      expect(PlaidEnvironments.production).toBeDefined();
    });
  });
});

// Test helper to validate that all our existing Plaid imports still work
describe('Plaid Import Compatibility', () => {
  test('should import all required Plaid types and classes', () => {
    // If these imports work, the module structure is compatible
    expect(PlaidApi).toBeDefined();
    expect(Configuration).toBeDefined();
    expect(PlaidEnvironments).toBeDefined();
    expect(PlaidEnvironments.sandbox).toBeDefined();
  });
});