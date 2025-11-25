/**
 * AES-256-GCM Encryption Utilities for Sensitive Data
 *
 * Provides secure encryption/decryption for sensitive data like Plaid access tokens.
 * Uses AES-256-GCM for authenticated encryption with additional data protection.
 *
 * Security Features:
 * - AES-256-GCM authenticated encryption
 * - Unique initialization vectors (IVs) for each encryption
 * - Authentication tags prevent tampering
 * - Base64 encoding for safe database storage
 *
 * Format: {iv}:{authTag}:{encryptedData} (all base64 encoded)
 */

import * as crypto from 'crypto';
import { defineSecret } from 'firebase-functions/params';

// Define encryption key secret
const encryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

// Constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Interface for encrypted data structure
 */
export interface EncryptedData {
  iv: string;      // Base64 encoded initialization vector
  authTag: string; // Base64 encoded authentication tag
  data: string;    // Base64 encoded encrypted data
}

/**
 * Validates and derives encryption key
 */
function getEncryptionKey(): Buffer {
  const key = encryptionKey.value();

  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  }

  // Support both hex strings and direct keys
  let keyBuffer: Buffer;
  if (key.length === 64) {
    // 64 character hex string (32 bytes * 2)
    keyBuffer = Buffer.from(key, 'hex');
  } else if (key.length === 44) {
    // Base64 encoded 32-byte key
    keyBuffer = Buffer.from(key, 'base64');
  } else if (Buffer.byteLength(key, 'utf8') >= KEY_LENGTH) {
    // Direct key, truncate or hash to 32 bytes
    keyBuffer = crypto.createHash('sha256').update(key).digest();
  } else {
    throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 bytes or 64 hex characters');
  }

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be exactly ${KEY_LENGTH} bytes`);
  }

  return keyBuffer;
}

/**
 * Encrypts sensitive data using AES-256-GCM
 *
 * @param plaintext - The data to encrypt (e.g., Plaid access token)
 * @returns Encrypted data object with IV, auth tag, and encrypted data
 */
export function encryptSensitiveData(plaintext: string): EncryptedData {
  try {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a non-empty string');
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted
    };
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error(`Failed to encrypt sensitive data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypts sensitive data using AES-256-GCM
 *
 * @param encryptedData - The encrypted data object
 * @returns Decrypted plaintext data
 */
export function decryptSensitiveData(encryptedData: EncryptedData): string {
  try {
    if (!encryptedData || !encryptedData.iv || !encryptedData.authTag || !encryptedData.data) {
      throw new Error('Invalid encrypted data structure');
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error(`Failed to decrypt sensitive data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Encrypts data for storage (returns serialized string)
 *
 * @param plaintext - The data to encrypt
 * @returns Base64-encoded serialized encrypted data
 */
export function encryptForStorage(plaintext: string): string {
  const encrypted = encryptSensitiveData(plaintext);
  const serialized = `${encrypted.iv}:${encrypted.authTag}:${encrypted.data}`;
  return Buffer.from(serialized).toString('base64');
}

/**
 * Decrypts data from storage (parses serialized string)
 *
 * @param encryptedString - Base64-encoded serialized encrypted data
 * @returns Decrypted plaintext data
 */
export function decryptFromStorage(encryptedString: string): string {
  try {
    const serialized = Buffer.from(encryptedString, 'base64').toString('utf8');
    const parts = serialized.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const encryptedData: EncryptedData = {
      iv: parts[0],
      authTag: parts[1],
      data: parts[2]
    };

    return decryptSensitiveData(encryptedData);
  } catch (error) {
    console.error('Storage decryption failed:', error);
    throw new Error(`Failed to decrypt from storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Safely encrypts Plaid access token for storage
 *
 * @param accessToken - Plaid access token
 * @returns Encrypted token string for database storage
 */
export function encryptAccessToken(accessToken: string): string {
  if (!accessToken || !accessToken.startsWith('access-')) {
    throw new Error('Invalid Plaid access token format');
  }

  return encryptForStorage(accessToken);
}

/**
 * Safely decrypts Plaid access token from storage
 *
 * @param encryptedToken - Encrypted token from database
 * @returns Decrypted Plaid access token
 */
export function decryptAccessToken(encryptedToken: string): string {
  const decrypted = decryptFromStorage(encryptedToken);

  if (!decrypted || !decrypted.startsWith('access-')) {
    throw new Error('Decrypted token does not appear to be a valid Plaid access token');
  }

  return decrypted;
}

/**
 * Checks if a token appears to be encrypted
 *
 * @param token - Token to check
 * @returns True if token appears encrypted, false if plaintext
 */
export function isTokenEncrypted(token: string): boolean {
  if (!token) return false;

  // Plaintext Plaid tokens start with 'access-'
  if (token.startsWith('access-')) {
    return false;
  }

  // Encrypted tokens are base64 encoded with specific structure
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    return parts.length === 3; // iv:authTag:data format
  } catch {
    return false;
  }
}

/**
 * Safely migrates plaintext token to encrypted token
 * Used for backward compatibility during token encryption rollout
 *
 * @param token - Token that might be plaintext or encrypted
 * @returns Encrypted token (encrypts if plaintext, returns as-is if already encrypted)
 */
export function migrateToEncryptedToken(token: string): string {
  if (isTokenEncrypted(token)) {
    return token; // Already encrypted
  }

  return encryptAccessToken(token); // Encrypt plaintext token
}

/**
 * Safely retrieves access token (handles both encrypted and plaintext)
 * Used during migration period for backward compatibility
 *
 * @param token - Token from storage (might be encrypted or plaintext)
 * @returns Plaintext access token
 */
export function getAccessToken(token: string): string {
  if (isTokenEncrypted(token)) {
    return decryptAccessToken(token);
  }

  // Return plaintext token (for backward compatibility)
  return token;
}

/**
 * Generate a secure encryption key for initial setup
 * This is a utility function for generating TOKEN_ENCRYPTION_KEY
 */
export function generateEncryptionKey(): string {
  const key = crypto.randomBytes(KEY_LENGTH);
  return key.toString('hex');
}

/**
 * Validates encryption configuration and key
 * Used for health checks and startup validation
 */
export function validateEncryptionConfig(): { valid: boolean; error?: string } {
  try {
    getEncryptionKey();

    // Test encryption/decryption cycle
    const testData = 'access-test-token-validation';
    const encrypted = encryptForStorage(testData);
    const decrypted = decryptFromStorage(encrypted);

    if (decrypted !== testData) {
      return { valid: false, error: 'Encryption/decryption cycle failed' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown encryption error'
    };
  }
}