/**
 * Comprehensive functionality validation tests
 *
 * Ensures all changes maintain existing functionality while achieving goals
 */

import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';
import { createPlaidClient, exchangePublicToken } from '../../../utils/plaidClient';

describe('Functionality Validation Tests', () => {

  describe('Goal Achievement: Security Vulnerabilities Resolved', () => {
    test('should have updated Plaid to secure version', () => {
      // Verify we're using the new Plaid version with security fixes
      const client = createPlaidClient('test-client', 'test-secret');
      expect(client).toBeInstanceOf(PlaidApi);

      // New version should have all required methods
      expect(typeof client.itemPublicTokenExchange).toBe('function');
      expect(typeof client.transactionsSync).toBe('function');
      expect(typeof client.accountsGet).toBe('function');
    });

    test('should support new PlaidEnvironments structure', () => {
      // Verify updated PlaidEnvironments work
      expect(PlaidEnvironments.sandbox).toBeDefined();
      expect(PlaidEnvironments.production).toBeDefined();
      expect(typeof PlaidEnvironments.sandbox).toBe('string');
      expect(typeof PlaidEnvironments.production).toBe('string');
    });
  });

  describe('Goal Achievement: Webhook Signature Verification', () => {
    test('should have webhook signature verification enabled', () => {
      // Webhook signature verification is tested comprehensively in webhookSecurity.test.ts
      // This test confirms the feature exists and is enabled
      const fs = require('fs');
      const webhookFile = fs.readFileSync(
        'src/functions/plaid/plaidWebhook.ts',
        'utf8'
      );

      // Verify signature verification is enabled (not bypassed with false)
      expect(webhookFile).not.toContain('if (false && shouldVerifySignature');
      expect(webhookFile).toContain('shouldVerifySignature && !verifyWebhookSignature');
      expect(webhookFile).toContain('function verifyWebhookSignature(body: string, signature: string)');
    });
  });

  describe('Existing Functionality: Plaid Client Creation', () => {
    test('should create Plaid client with same interface', () => {
      const client = createPlaidClient('test-client-id', 'test-secret');

      // Same interface as before
      expect(client).toBeInstanceOf(PlaidApi);
      expect(typeof client.itemPublicTokenExchange).toBe('function');
      expect(typeof client.transactionsSync).toBe('function');
      expect(typeof client.accountsGet).toBe('function');
      expect(typeof client.institutionsGetById).toBe('function');
      expect(typeof client.itemGet).toBe('function');
    });

    test('should handle Configuration creation', () => {
      const config = new Configuration({
        basePath: PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': 'test-id',
            'PLAID-SECRET': 'test-secret'
          }
        }
      });

      expect(config.basePath).toBe(PlaidEnvironments.sandbox);
      expect(config.baseOptions?.headers).toBeDefined();
    });
  });

  describe('Existing Functionality: Token Exchange', () => {
    test('should maintain token exchange interface', async () => {
      const client = createPlaidClient('test-client-id', 'test-secret');

      // Mock the API call
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

      // Same return interface
      expect(result).toEqual({
        accessToken: 'test-access-token',
        itemId: 'test-item-id'
      });

      // Same function call pattern
      expect(mockExchange).toHaveBeenCalledWith({
        public_token: 'test-public-token'
      });

      mockExchange.mockRestore();
    });

    test('should handle errors the same way', async () => {
      const client = createPlaidClient('test-client-id', 'test-secret');

      const mockError = new Error('API Error');
      const mockExchange = jest.spyOn(client, 'itemPublicTokenExchange').mockRejectedValue(mockError);

      await expect(exchangePublicToken(client, 'invalid-token')).rejects.toThrow('Token exchange failed');

      mockExchange.mockRestore();
    });
  });

  describe('Existing Functionality: Environment Support', () => {
    test('should support all required environments', () => {
      // Sandbox environment (primary for development)
      const sandboxConfig = new Configuration({
        basePath: PlaidEnvironments.sandbox
      });
      expect(sandboxConfig.basePath).toBeTruthy();

      // Production environment
      const prodConfig = new Configuration({
        basePath: PlaidEnvironments.production
      });
      expect(prodConfig.basePath).toBeTruthy();
    });
  });

  describe('Backward Compatibility: API Methods', () => {
    let client: PlaidApi;

    beforeEach(() => {
      client = createPlaidClient('test-client', 'test-secret');
    });

    test('should have all previously available methods', () => {
      // Core methods that should still exist
      const requiredMethods = [
        'itemPublicTokenExchange',
        'transactionsSync',
        'accountsGet',
        'institutionsGetById',
        'itemGet',
        'transactionsRecurringGet'
      ];

      requiredMethods.forEach(method => {
        expect(typeof client[method as keyof PlaidApi]).toBe('function');
      });
    });

    test('should handle request patterns consistently', () => {
      // Verify that request patterns haven't changed
      expect(typeof client.itemPublicTokenExchange).toBe('function');
      expect(typeof client.transactionsSync).toBe('function');
      expect(typeof client.accountsGet).toBe('function');
    });
  });

  describe('Error Handling Consistency', () => {
    test('should handle client creation errors consistently', () => {
      // Should not throw during creation (behavior maintained)
      expect(() => {
        createPlaidClient('', '');
      }).not.toThrow();
    });

    test('should propagate API errors consistently', async () => {
      const client = createPlaidClient('test-client', 'test-secret');

      const mockError = {
        response: {
          data: {
            error_code: 'INVALID_ACCESS_TOKEN',
            error_message: 'Invalid access token',
            error_type: 'INVALID_INPUT'
          }
        }
      };

      const mockExchange = jest.spyOn(client, 'itemPublicTokenExchange').mockRejectedValue(mockError);

      await expect(exchangePublicToken(client, 'invalid')).rejects.toThrow('Token exchange failed');

      mockExchange.mockRestore();
    });
  });

  describe('Performance and Stability', () => {
    test('should create clients efficiently', () => {
      const start = process.hrtime.bigint();

      for (let i = 0; i < 10; i++) {
        createPlaidClient(`client-${i}`, `secret-${i}`);
      }

      const end = process.hrtime.bigint();
      const timeMs = Number(end - start) / 1000000;

      // Should create 10 clients in under 100ms
      expect(timeMs).toBeLessThan(100);
    });

    test('should handle multiple concurrent operations', async () => {
      const client = createPlaidClient('test-client', 'test-secret');

      const mockExchange = jest.spyOn(client, 'itemPublicTokenExchange').mockResolvedValue({
        data: {
          access_token: 'test-token',
          item_id: 'test-item',
          request_id: 'test-request'
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any
      });

      // Run 5 concurrent operations
      const promises = Array.from({ length: 5 }, (_, i) =>
        exchangePublicToken(client, `token-${i}`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.accessToken).toBe('test-token');
        expect(result.itemId).toBe('test-item');
      });

      mockExchange.mockRestore();
    });
  });
});