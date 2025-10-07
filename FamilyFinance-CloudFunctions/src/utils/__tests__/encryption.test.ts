/**
 * Comprehensive test suite for encryption utilities
 *
 * Tests AES-256-GCM encryption/decryption for Plaid access tokens
 * and other sensitive data with security validation.
 */

import * as crypto from 'crypto';
import {
  encryptSensitiveData,
  decryptSensitiveData,
  encryptForStorage,
  decryptFromStorage,
  encryptAccessToken,
  decryptAccessToken,
  isTokenEncrypted,
  migrateToEncryptedToken,
  getAccessToken,
  generateEncryptionKey,
  validateEncryptionConfig,
  EncryptedData
} from '../encryption';

// Mock the Firebase secret
jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn(() => ({
    value: () => 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' // 64-char hex key
  }))
}));

describe('Encryption Utilities', () => {
  const testPlaidToken = 'access-sandbox-test-item-12345-abcde';
  const testSensitiveData = 'sensitive-information-to-encrypt';

  describe('Core Encryption/Decryption', () => {
    test('should encrypt and decrypt data successfully', () => {
      const encrypted = encryptSensitiveData(testSensitiveData);

      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted).toHaveProperty('data');
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.data).toBeTruthy();

      const decrypted = decryptSensitiveData(encrypted);
      expect(decrypted).toBe(testSensitiveData);
    });

    test('should generate unique IVs for each encryption', () => {
      const encrypted1 = encryptSensitiveData(testSensitiveData);
      const encrypted2 = encryptSensitiveData(testSensitiveData);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.authTag).not.toBe(encrypted2.authTag);
      expect(encrypted1.data).not.toBe(encrypted2.data);

      // Both should decrypt to same plaintext
      expect(decryptSensitiveData(encrypted1)).toBe(testSensitiveData);
      expect(decryptSensitiveData(encrypted2)).toBe(testSensitiveData);
    });

    test('should handle empty and edge case inputs', () => {
      expect(() => encryptSensitiveData('')).toThrow('non-empty string');
      expect(() => encryptSensitiveData(null as any)).toThrow('non-empty string');
      expect(() => encryptSensitiveData(undefined as any)).toThrow('non-empty string');
    });
  });

  describe('Storage Format Encryption/Decryption', () => {
    test('should encrypt for storage and decrypt correctly', () => {
      const encrypted = encryptForStorage(testSensitiveData);

      // Should be base64 encoded string
      expect(typeof encrypted).toBe('string');
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();

      const decrypted = decryptFromStorage(encrypted);
      expect(decrypted).toBe(testSensitiveData);
    });

    test('should handle malformed storage data', () => {
      expect(() => decryptFromStorage('invalid-data')).toThrow();
      expect(() => decryptFromStorage('')).toThrow();

      // Invalid base64
      expect(() => decryptFromStorage('not-base64!')).toThrow();

      // Valid base64 but wrong format
      const invalidFormat = Buffer.from('wrong:format').toString('base64');
      expect(() => decryptFromStorage(invalidFormat)).toThrow();
    });
  });

  describe('Plaid Access Token Encryption', () => {
    test('should encrypt and decrypt Plaid access tokens', () => {
      const encrypted = encryptAccessToken(testPlaidToken);
      expect(encrypted).not.toBe(testPlaidToken);
      expect(encrypted.length).toBeGreaterThan(50); // Encrypted data should be longer

      const decrypted = decryptAccessToken(encrypted);
      expect(decrypted).toBe(testPlaidToken);
    });

    test('should validate Plaid token format', () => {
      expect(() => encryptAccessToken('invalid-token')).toThrow('Invalid Plaid access token format');
      expect(() => encryptAccessToken('')).toThrow('Invalid Plaid access token format');
      expect(() => encryptAccessToken('random-string')).toThrow('Invalid Plaid access token format');
    });

    test('should validate decrypted token format', () => {
      // Create encrypted data that decrypts to invalid token
      const invalidEncrypted = encryptForStorage('invalid-decrypted-token');
      expect(() => decryptAccessToken(invalidEncrypted)).toThrow('does not appear to be a valid Plaid access token');
    });
  });

  describe('Token Detection and Migration', () => {
    test('should correctly identify encrypted vs plaintext tokens', () => {
      const encryptedToken = encryptAccessToken(testPlaidToken);

      expect(isTokenEncrypted(testPlaidToken)).toBe(false);
      expect(isTokenEncrypted(encryptedToken)).toBe(true);
      expect(isTokenEncrypted('')).toBe(false);
      expect(isTokenEncrypted('invalid-base64!')).toBe(false);
    });

    test('should migrate plaintext tokens to encrypted', () => {
      const encryptedToken = migrateToEncryptedToken(testPlaidToken);
      expect(isTokenEncrypted(encryptedToken)).toBe(true);
      expect(decryptAccessToken(encryptedToken)).toBe(testPlaidToken);

      // Should not re-encrypt already encrypted tokens
      const alreadyEncrypted = encryptAccessToken(testPlaidToken);
      const migrated = migrateToEncryptedToken(alreadyEncrypted);
      expect(migrated).toBe(alreadyEncrypted);
    });

    test('should safely retrieve tokens (backward compatibility)', () => {
      const encryptedToken = encryptAccessToken(testPlaidToken);

      // Should handle encrypted tokens
      expect(getAccessToken(encryptedToken)).toBe(testPlaidToken);

      // Should handle plaintext tokens (backward compatibility)
      expect(getAccessToken(testPlaidToken)).toBe(testPlaidToken);
    });
  });

  describe('Authentication and Tampering Protection', () => {
    test('should detect tampered encrypted data', () => {
      const encrypted = encryptSensitiveData(testSensitiveData);

      // Tamper with auth tag
      const tamperedAuth: EncryptedData = {
        ...encrypted,
        authTag: Buffer.from('tampered', 'utf8').toString('base64')
      };
      expect(() => decryptSensitiveData(tamperedAuth)).toThrow();

      // Tamper with encrypted data
      const tamperedData: EncryptedData = {
        ...encrypted,
        data: Buffer.from('tampered-data', 'utf8').toString('base64')
      };
      expect(() => decryptSensitiveData(tamperedData)).toThrow();

      // Tamper with IV
      const tamperedIV: EncryptedData = {
        ...encrypted,
        iv: crypto.randomBytes(16).toString('base64')
      };
      expect(() => decryptSensitiveData(tamperedIV)).toThrow();
    });

    test('should handle corrupted storage format', () => {
      const encrypted = encryptForStorage(testSensitiveData);

      // Corrupt the base64 data
      const corrupted = encrypted.slice(0, -5) + 'xxxxx';
      expect(() => decryptFromStorage(corrupted)).toThrow();

      // Modify parts of the encoded data
      const decoded = Buffer.from(encrypted, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const modified = `${parts[0]}:corrupted:${parts[2]}`;
      const reencoded = Buffer.from(modified).toString('base64');

      expect(() => decryptFromStorage(reencoded)).toThrow();
    });
  });

  describe('Security Properties', () => {
    test('should use different IVs for identical data', () => {
      const encrypted1 = encryptSensitiveData(testSensitiveData);
      const encrypted2 = encryptSensitiveData(testSensitiveData);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.data).not.toBe(encrypted2.data);
      expect(encrypted1.authTag).not.toBe(encrypted2.authTag);
    });

    test('should produce different encrypted outputs each time', () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(encryptForStorage(testSensitiveData));
      }

      // All results should be different
      const unique = new Set(results);
      expect(unique.size).toBe(5);

      // All should decrypt to same value
      results.forEach(encrypted => {
        expect(decryptFromStorage(encrypted)).toBe(testSensitiveData);
      });
    });

    test('should handle large data efficiently', () => {
      const largeData = 'x'.repeat(10000); // 10KB of data

      const start = process.hrtime.bigint();
      const encrypted = encryptForStorage(largeData);
      const decrypted = decryptFromStorage(encrypted);
      const end = process.hrtime.bigint();

      expect(decrypted).toBe(largeData);

      // Should complete in reasonable time (< 100ms)
      const timeMs = Number(end - start) / 1000000;
      expect(timeMs).toBeLessThan(100);
    });
  });

  describe('Key Management and Validation', () => {
    test('should generate valid encryption keys', () => {
      const key = generateEncryptionKey();

      expect(key).toHaveLength(64); // 32 bytes * 2 for hex
      expect(key).toMatch(/^[0-9a-f]{64}$/); // Valid hex string
    });

    test('should validate encryption configuration', () => {
      const result = validateEncryptionConfig();
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should provide meaningful error messages', () => {
      expect(() => encryptSensitiveData('')).toThrow('non-empty string');
      expect(() => decryptSensitiveData({} as any)).toThrow('Invalid encrypted data structure');
      expect(() => decryptFromStorage('invalid')).toThrow('Failed to decrypt from storage');
      expect(() => encryptAccessToken('wrong-format')).toThrow('Invalid Plaid access token format');
    });

    test('should handle malformed encrypted data gracefully', () => {
      const malformed: EncryptedData = {
        iv: 'not-base64!',
        authTag: 'also-not-base64!',
        data: 'definitely-not-base64!'
      };

      expect(() => decryptSensitiveData(malformed)).toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    test('should encrypt/decrypt quickly', () => {
      const iterations = 100;
      const data = testPlaidToken;

      const start = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        const encrypted = encryptForStorage(data);
        const decrypted = decryptFromStorage(encrypted);
        expect(decrypted).toBe(data);
      }

      const end = process.hrtime.bigint();
      const totalTimeMs = Number(end - start) / 1000000;
      const avgTimeMs = totalTimeMs / iterations;

      // Average should be under 5ms per encrypt/decrypt cycle
      expect(avgTimeMs).toBeLessThan(5);
    });

    test('should handle concurrent operations', async () => {
      const promises = Array.from({ length: 50 }, async (_, i) => {
        const data = `${testPlaidToken}-${i}`;
        const encrypted = encryptForStorage(data);
        const decrypted = decryptFromStorage(encrypted);
        return { original: data, decrypted };
      });

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.decrypted).toBe(result.original);
      });
    });
  });

  describe('Real-world Scenarios', () => {
    test('should handle actual Plaid token formats', () => {
      const realTokens = [
        'access-sandbox-test-item-123456-abcdef',
        'access-production-real-item-789012-fedcba',
        'access-development-mock-item-345678-123abc'
      ];

      realTokens.forEach(token => {
        const encrypted = encryptAccessToken(token);
        const decrypted = decryptAccessToken(encrypted);
        expect(decrypted).toBe(token);
        expect(isTokenEncrypted(encrypted)).toBe(true);
        expect(isTokenEncrypted(token)).toBe(false);
      });
    });

    test('should maintain data integrity across multiple operations', () => {
      let current = testPlaidToken;

      // Encrypt and decrypt 10 times
      for (let i = 0; i < 10; i++) {
        const encrypted = encryptAccessToken(current);
        current = decryptAccessToken(encrypted);
      }

      expect(current).toBe(testPlaidToken);
    });
  });
});