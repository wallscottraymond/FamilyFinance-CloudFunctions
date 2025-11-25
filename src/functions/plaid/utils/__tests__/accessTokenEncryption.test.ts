/**
 * Integration tests for access token encryption in Plaid functions
 *
 * Validates that access tokens are properly encrypted when stored
 * and correctly decrypted when retrieved for API calls.
 */

import {
  encryptAccessToken,
  decryptAccessToken,
  getAccessToken,
  isTokenEncrypted,
  migrateToEncryptedToken
} from '../../../utils/encryption';

// Mock Firebase secrets for testing
jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn(() => ({
    value: () => 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' // 64-char hex key
  }))
}));

describe('Access Token Encryption Integration', () => {
  const testPlaidToken = 'access-sandbox-test-item-12345-abcdef';
  const anotherTestToken = 'access-production-real-item-67890-fedcba';

  describe('Token Storage Integration', () => {
    test('should encrypt tokens before storage', () => {
      const encrypted = encryptAccessToken(testPlaidToken);

      expect(encrypted).not.toBe(testPlaidToken);
      expect(encrypted.length).toBeGreaterThan(100); // Encrypted tokens are longer
      expect(isTokenEncrypted(encrypted)).toBe(true);

      // Should decrypt back to original
      const decrypted = decryptAccessToken(encrypted);
      expect(decrypted).toBe(testPlaidToken);
    });

    test('should handle multiple different tokens', () => {
      const encrypted1 = encryptAccessToken(testPlaidToken);
      const encrypted2 = encryptAccessToken(anotherTestToken);

      // Different tokens should produce different encrypted values
      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt correctly
      expect(decryptAccessToken(encrypted1)).toBe(testPlaidToken);
      expect(decryptAccessToken(encrypted2)).toBe(anotherTestToken);
    });
  });

  describe('Backward Compatibility', () => {
    test('should handle plaintext tokens (backward compatibility)', () => {
      // getAccessToken should handle both encrypted and plaintext
      expect(getAccessToken(testPlaidToken)).toBe(testPlaidToken);

      const encrypted = encryptAccessToken(testPlaidToken);
      expect(getAccessToken(encrypted)).toBe(testPlaidToken);
    });

    test('should migrate plaintext tokens to encrypted', () => {
      const migrated = migrateToEncryptedToken(testPlaidToken);

      expect(isTokenEncrypted(migrated)).toBe(true);
      expect(getAccessToken(migrated)).toBe(testPlaidToken);

      // Should not re-encrypt already encrypted tokens
      const alreadyEncrypted = encryptAccessToken(testPlaidToken);
      const migratedAgain = migrateToEncryptedToken(alreadyEncrypted);
      expect(migratedAgain).toBe(alreadyEncrypted);
    });
  });

  describe('Database Integration Simulation', () => {
    test('should simulate complete storage and retrieval cycle', () => {
      // Simulate storing token in database
      const tokenToStore = testPlaidToken;
      const encryptedForStorage = encryptAccessToken(tokenToStore);

      // Simulate database storage (would be stored as encryptedForStorage)
      const storedData = {
        itemId: 'test-item-123',
        userId: 'test-user-456',
        accessToken: encryptedForStorage,
        institutionName: 'Test Bank'
      };

      // Simulate retrieval from database
      const retrievedToken = storedData.accessToken;
      const decryptedToken = getAccessToken(retrievedToken);

      expect(decryptedToken).toBe(testPlaidToken);
      expect(isTokenEncrypted(retrievedToken)).toBe(true);
    });

    test('should handle migration scenario with existing plaintext tokens', () => {
      // Simulate existing database record with plaintext token
      const existingData = {
        itemId: 'existing-item-123',
        userId: 'existing-user-456',
        accessToken: testPlaidToken, // Plaintext token (legacy)
        institutionName: 'Legacy Bank'
      };

      // Simulate reading and migrating token
      const currentToken = existingData.accessToken;
      const migratedToken = migrateToEncryptedToken(currentToken);

      // Update the record with encrypted token
      existingData.accessToken = migratedToken;

      // Verify migration worked
      expect(isTokenEncrypted(existingData.accessToken)).toBe(true);
      expect(getAccessToken(existingData.accessToken)).toBe(testPlaidToken);
    });
  });

  describe('Security Validation', () => {
    test('should not expose plaintext tokens in encrypted format', () => {
      const encrypted = encryptAccessToken(testPlaidToken);

      // Encrypted token should not contain plaintext
      expect(encrypted).not.toContain(testPlaidToken);
      expect(encrypted).not.toContain('access-');
      expect(encrypted).not.toContain('sandbox');
      expect(encrypted).not.toContain('12345');
    });

    test('should generate different encrypted values each time', () => {
      const encrypted1 = encryptAccessToken(testPlaidToken);
      const encrypted2 = encryptAccessToken(testPlaidToken);
      const encrypted3 = encryptAccessToken(testPlaidToken);

      // All should be different due to unique IVs
      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);
      expect(encrypted1).not.toBe(encrypted3);

      // All should decrypt to same value
      expect(decryptAccessToken(encrypted1)).toBe(testPlaidToken);
      expect(decryptAccessToken(encrypted2)).toBe(testPlaidToken);
      expect(decryptAccessToken(encrypted3)).toBe(testPlaidToken);
    });

    test('should detect and reject invalid encrypted tokens', () => {
      expect(() => decryptAccessToken('invalid-encrypted-token')).toThrow();
      expect(() => decryptAccessToken('')).toThrow();
      expect(() => decryptAccessToken('not-base64!')).toThrow();

      // Valid base64 but invalid structure
      const invalidStructure = Buffer.from('invalid:structure').toString('base64');
      expect(() => decryptAccessToken(invalidStructure)).toThrow();
    });
  });

  describe('Performance and Reliability', () => {
    test('should encrypt and decrypt quickly', () => {
      const start = process.hrtime.bigint();

      for (let i = 0; i < 100; i++) {
        const encrypted = encryptAccessToken(testPlaidToken);
        const decrypted = getAccessToken(encrypted);
        expect(decrypted).toBe(testPlaidToken);
      }

      const end = process.hrtime.bigint();
      const totalTimeMs = Number(end - start) / 1000000;
      const avgTimeMs = totalTimeMs / 100;

      // Should average less than 2ms per encrypt/decrypt cycle
      expect(avgTimeMs).toBeLessThan(2);
    });

    test('should handle concurrent operations safely', async () => {
      const promises = Array.from({ length: 50 }, async (_, i) => {
        const token = `access-test-${i}-concurrent-test`;
        const encrypted = encryptAccessToken(token);
        const decrypted = getAccessToken(encrypted);
        return { original: token, decrypted };
      });

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.decrypted).toBe(result.original);
      });
    });

    test('should maintain data integrity across multiple operations', () => {
      let currentToken = testPlaidToken;

      // Encrypt and decrypt 20 times
      for (let i = 0; i < 20; i++) {
        const encrypted = encryptAccessToken(currentToken);
        currentToken = getAccessToken(encrypted);
      }

      expect(currentToken).toBe(testPlaidToken);
    });
  });

  describe('Error Scenarios', () => {
    test('should handle malformed Plaid tokens gracefully', () => {
      expect(() => encryptAccessToken('malformed-token')).toThrow('Invalid Plaid access token format');
      expect(() => encryptAccessToken('')).toThrow('Invalid Plaid access token format');
      expect(() => encryptAccessToken('wrong-prefix-12345')).toThrow('Invalid Plaid access token format');
    });

    test('should provide clear error messages for invalid operations', () => {
      expect(() => encryptAccessToken('invalid')).toThrow('Invalid Plaid access token format');
      expect(() => decryptAccessToken('corrupted')).toThrow('Failed to decrypt');
    });

    test('should handle edge cases in token detection', () => {
      expect(isTokenEncrypted('')).toBe(false);
      expect(isTokenEncrypted('access-token-but-not-encrypted')).toBe(false);
      expect(isTokenEncrypted('random-string')).toBe(false);

      const encrypted = encryptAccessToken(testPlaidToken);
      expect(isTokenEncrypted(encrypted)).toBe(true);
    });
  });

  describe('Integration with Plaid Functions', () => {
    test('should simulate plaidAccounts.ts integration', () => {
      // Simulate savePlaidItem function behavior
      const accessToken = testPlaidToken;
      const encryptedForStorage = encryptAccessToken(accessToken);

      // Simulate database document
      const plaidItemDoc = {
        itemId: 'test-item-123',
        userId: 'test-user-456',
        institutionName: 'Test Bank',
        accessToken: encryptedForStorage, // Encrypted in storage
        cursor: null,
        products: ['transactions'],
        status: 'good'
      };

      // Simulate retrieval and usage
      const retrievedToken = getAccessToken(plaidItemDoc.accessToken);
      expect(retrievedToken).toBe(testPlaidToken);
      expect(retrievedToken.startsWith('access-')).toBe(true);
    });

    test('should simulate syncPlaidTransactions.ts integration', () => {
      // Simulate webhook processing where token needs to be decrypted
      const itemData = {
        id: 'item-doc-id',
        accessToken: encryptAccessToken(testPlaidToken),
        userId: 'user-123',
        itemId: 'plaid-item-456'
      };

      // Simulate the decryption in syncPlaidTransactions
      const encryptedAccessToken = itemData.accessToken;
      const accessToken = getAccessToken(encryptedAccessToken);

      expect(accessToken).toBe(testPlaidToken);
      expect(accessToken).not.toBe(encryptedAccessToken);
    });
  });
});