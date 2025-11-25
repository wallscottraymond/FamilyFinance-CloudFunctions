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
/**
 * Interface for encrypted data structure
 */
export interface EncryptedData {
    iv: string;
    authTag: string;
    data: string;
}
/**
 * Encrypts sensitive data using AES-256-GCM
 *
 * @param plaintext - The data to encrypt (e.g., Plaid access token)
 * @returns Encrypted data object with IV, auth tag, and encrypted data
 */
export declare function encryptSensitiveData(plaintext: string): EncryptedData;
/**
 * Decrypts sensitive data using AES-256-GCM
 *
 * @param encryptedData - The encrypted data object
 * @returns Decrypted plaintext data
 */
export declare function decryptSensitiveData(encryptedData: EncryptedData): string;
/**
 * Encrypts data for storage (returns serialized string)
 *
 * @param plaintext - The data to encrypt
 * @returns Base64-encoded serialized encrypted data
 */
export declare function encryptForStorage(plaintext: string): string;
/**
 * Decrypts data from storage (parses serialized string)
 *
 * @param encryptedString - Base64-encoded serialized encrypted data
 * @returns Decrypted plaintext data
 */
export declare function decryptFromStorage(encryptedString: string): string;
/**
 * Safely encrypts Plaid access token for storage
 *
 * @param accessToken - Plaid access token
 * @returns Encrypted token string for database storage
 */
export declare function encryptAccessToken(accessToken: string): string;
/**
 * Safely decrypts Plaid access token from storage
 *
 * @param encryptedToken - Encrypted token from database
 * @returns Decrypted Plaid access token
 */
export declare function decryptAccessToken(encryptedToken: string): string;
/**
 * Checks if a token appears to be encrypted
 *
 * @param token - Token to check
 * @returns True if token appears encrypted, false if plaintext
 */
export declare function isTokenEncrypted(token: string): boolean;
/**
 * Safely migrates plaintext token to encrypted token
 * Used for backward compatibility during token encryption rollout
 *
 * @param token - Token that might be plaintext or encrypted
 * @returns Encrypted token (encrypts if plaintext, returns as-is if already encrypted)
 */
export declare function migrateToEncryptedToken(token: string): string;
/**
 * Safely retrieves access token (handles both encrypted and plaintext)
 * Used during migration period for backward compatibility
 *
 * @param token - Token from storage (might be encrypted or plaintext)
 * @returns Plaintext access token
 */
export declare function getAccessToken(token: string): string;
/**
 * Generate a secure encryption key for initial setup
 * This is a utility function for generating TOKEN_ENCRYPTION_KEY
 */
export declare function generateEncryptionKey(): string;
/**
 * Validates encryption configuration and key
 * Used for health checks and startup validation
 */
export declare function validateEncryptionConfig(): {
    valid: boolean;
    error?: string;
};
//# sourceMappingURL=encryption.d.ts.map