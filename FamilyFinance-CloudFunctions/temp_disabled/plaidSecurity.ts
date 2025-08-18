import { createHmac, createCipherGCM, createDecipherGCM, randomBytes } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Plaid Security Utilities
 * 
 * Handles encryption/decryption of sensitive Plaid tokens and webhook signature verification
 * Uses AES-256-GCM for encryption and HMAC-SHA256 for webhook verification
 */

// Constants
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const WEBHOOK_SIGNATURE_ALGORITHM = 'sha256';
const TOKEN_ENCRYPTION_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

// Environment variables for security keys
const PLAID_WEBHOOK_SECRET = process.env.PLAID_WEBHOOK_SECRET;
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;

if (!PLAID_WEBHOOK_SECRET) {
  throw new Error('PLAID_WEBHOOK_SECRET environment variable is required');
}

if (!TOKEN_ENCRYPTION_KEY || TOKEN_ENCRYPTION_KEY.length !== 64) {
  throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
}

/**
 * Encrypted data structure for storing sensitive tokens
 */
interface EncryptedData {
  encryptedText: string; // Base64 encoded encrypted data
  iv: string; // Base64 encoded initialization vector
  tag: string; // Base64 encoded authentication tag
  algorithm: string; // Encryption algorithm used
  keyVersion: number; // Version of encryption key used
}

/**
 * Webhook signature verification result
 */
interface WebhookVerificationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Encrypts a Plaid access token using AES-256-GCM
 * 
 * @param plaintext - The access token to encrypt
 * @returns Encrypted data object with all necessary components
 */
export function encryptAccessToken(plaintext: string): EncryptedData {
  try {
    if (!plaintext || plaintext.trim().length === 0) {
      throw new Error('Access token cannot be empty');
    }

    // Generate random IV for this encryption
    const iv = randomBytes(IV_LENGTH);
    
    // Convert hex key to buffer
    const key = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');
    
    // Create cipher
    const cipher = createCipherGCM(ENCRYPTION_ALGORITHM, key);
    cipher.setAAD(Buffer.from('plaid-access-token')); // Additional authenticated data
    
    // Encrypt the token
    cipher.update(iv);
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    return {
      encryptedText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      algorithm: ENCRYPTION_ALGORITHM,
      keyVersion: 1 // Current key version
    };
  } catch (error) {
    console.error('Error encrypting access token:', error);
    throw new Error('Failed to encrypt access token');
  }
}

/**
 * Decrypts a Plaid access token
 * 
 * @param encryptedData - The encrypted data object
 * @returns Decrypted access token
 */
export function decryptAccessToken(encryptedData: EncryptedData): string {
  try {
    if (!encryptedData || !encryptedData.encryptedText) {
      throw new Error('Invalid encrypted data');
    }

    // Verify algorithm
    if (encryptedData.algorithm !== ENCRYPTION_ALGORITHM) {
      throw new Error(`Unsupported encryption algorithm: ${encryptedData.algorithm}`);
    }

    // Convert from base64
    const encrypted = Buffer.from(encryptedData.encryptedText, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const tag = Buffer.from(encryptedData.tag, 'base64');
    
    // Convert hex key to buffer
    const key = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');
    
    // Create decipher
    const decipher = createDecipherGCM(ENCRYPTION_ALGORITHM, key);
    decipher.setAAD(Buffer.from('plaid-access-token')); // Must match encryption AAD
    decipher.setAuthTag(tag);
    
    // Decrypt
    decipher.update(iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Error decrypting access token:', error);
    throw new Error('Failed to decrypt access token');
  }
}

/**
 * Verifies a Plaid webhook signature
 * 
 * @param body - Raw webhook body (string or Buffer)
 * @param signature - Signature from the webhook headers
 * @returns Verification result
 */
export function verifyWebhookSignature(
  body: string | Buffer, 
  signature: string
): WebhookVerificationResult {
  try {
    if (!signature || signature.trim().length === 0) {
      return {
        isValid: false,
        error: 'Missing webhook signature'
      };
    }

    if (!body) {
      return {
        isValid: false,
        error: 'Missing webhook body'
      };
    }

    // Ensure body is a string
    const bodyString = typeof body === 'string' ? body : body.toString('utf8');
    
    // Calculate expected signature
    const expectedSignature = createHmac(WEBHOOK_SIGNATURE_ALGORITHM, PLAID_WEBHOOK_SECRET)
      .update(bodyString, 'utf8')
      .digest('hex');
    
    // Compare signatures (timing-safe comparison)
    const receivedSignature = signature.replace('sha256=', ''); // Remove prefix if present
    const isValid = timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
    
    return {
      isValid,
      error: isValid ? undefined : 'Invalid webhook signature'
    };
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return {
      isValid: false,
      error: `Signature verification failed: ${error.message}`
    };
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * 
 * @param a - First buffer
 * @param b - Second buffer
 * @returns True if buffers are equal
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
}

/**
 * Generates a new encryption key for token encryption
 * This should only be used during initial setup or key rotation
 * 
 * @returns Hex-encoded encryption key
 */
export function generateEncryptionKey(): string {
  return randomBytes(TOKEN_ENCRYPTION_KEY_LENGTH).toString('hex');
}

/**
 * Rotates access token encryption for an existing encrypted token
 * Used when rotating encryption keys
 * 
 * @param oldEncryptedData - Previously encrypted data
 * @param oldKey - Previous encryption key (hex string)
 * @returns New encrypted data with current key
 */
export function rotateTokenEncryption(
  oldEncryptedData: EncryptedData,
  oldKey: string
): EncryptedData {
  try {
    // Temporarily use old key to decrypt
    const originalKey = TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = oldKey;
    
    // Decrypt with old key
    const plaintext = decryptAccessToken(oldEncryptedData);
    
    // Restore current key
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    
    // Re-encrypt with current key
    return encryptAccessToken(plaintext);
  } catch (error) {
    console.error('Error rotating token encryption:', error);
    throw new Error('Failed to rotate token encryption');
  }
}

/**
 * Validates that an encrypted access token can be decrypted
 * Useful for health checks and validation
 * 
 * @param encryptedData - Encrypted data to validate
 * @returns True if token can be decrypted
 */
export function validateEncryptedToken(encryptedData: EncryptedData): boolean {
  try {
    const decrypted = decryptAccessToken(encryptedData);
    return decrypted && decrypted.length > 0;
  } catch {
    return false;
  }
}

/**
 * Creates a test webhook signature for development/testing
 * 
 * @param body - Webhook body
 * @returns HMAC signature for the body
 */
export function createTestWebhookSignature(body: string): string {
  return createHmac(WEBHOOK_SIGNATURE_ALGORITHM, PLAID_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('hex');
}

/**
 * Security configuration validation
 * Checks that all required security settings are properly configured
 */
export interface SecurityValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates the current security configuration
 * 
 * @returns Validation result with any errors or warnings
 */
export function validateSecurityConfiguration(): SecurityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check webhook secret
  if (!PLAID_WEBHOOK_SECRET) {
    errors.push('PLAID_WEBHOOK_SECRET environment variable is not set');
  } else if (PLAID_WEBHOOK_SECRET.length < 32) {
    warnings.push('PLAID_WEBHOOK_SECRET should be at least 32 characters long');
  }

  // Check encryption key
  if (!TOKEN_ENCRYPTION_KEY) {
    errors.push('TOKEN_ENCRYPTION_KEY environment variable is not set');
  } else {
    try {
      const keyBuffer = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');
      if (keyBuffer.length !== TOKEN_ENCRYPTION_KEY_LENGTH) {
        errors.push(`TOKEN_ENCRYPTION_KEY must be exactly ${TOKEN_ENCRYPTION_KEY_LENGTH} bytes (${TOKEN_ENCRYPTION_KEY_LENGTH * 2} hex characters)`);
      }
    } catch {
      errors.push('TOKEN_ENCRYPTION_KEY must be a valid hex string');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Plaid Configuration Security Manager
 * Handles secure storage and retrieval of Plaid configuration
 */
export class PlaidConfigurationManager {
  private db = getFirestore();
  private configRef = this.db.collection('plaid_configuration').doc('config');

  /**
   * Stores Plaid configuration securely
   * Client ID and other sensitive data is encrypted
   * 
   * @param config - Plaid configuration to store
   */
  async storeConfiguration(config: {
    clientId: string;
    environment: string;
    products: string[];
    countryCodes: string[];
    webhookUrl?: string;
    syncSettings: any;
    encryptionSettings: any;
    errorHandling: any;
  }): Promise<void> {
    try {
      // Encrypt sensitive fields
      const encryptedClientId = encryptAccessToken(config.clientId);
      
      const secureConfig = {
        ...config,
        clientId: encryptedClientId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.configRef.set(secureConfig);
    } catch (error) {
      console.error('Error storing Plaid configuration:', error);
      throw new Error('Failed to store Plaid configuration');
    }
  }

  /**
   * Retrieves and decrypts Plaid configuration
   * 
   * @returns Decrypted Plaid configuration
   */
  async getConfiguration(): Promise<any> {
    try {
      const doc = await this.configRef.get();
      
      if (!doc.exists) {
        throw new Error('Plaid configuration not found');
      }

      const config = doc.data();
      
      // Decrypt sensitive fields
      if (config?.clientId && typeof config.clientId === 'object') {
        config.clientId = decryptAccessToken(config.clientId);
      }

      return config;
    } catch (error) {
      console.error('Error retrieving Plaid configuration:', error);
      throw new Error('Failed to retrieve Plaid configuration');
    }
  }

  /**
   * Updates Plaid configuration
   * 
   * @param updates - Configuration updates to apply
   */
  async updateConfiguration(updates: Partial<any>): Promise<void> {
    try {
      // Encrypt clientId if it's being updated
      if (updates.clientId && typeof updates.clientId === 'string') {
        updates.clientId = encryptAccessToken(updates.clientId);
      }

      updates.updatedAt = new Date();

      await this.configRef.update(updates);
    } catch (error) {
      console.error('Error updating Plaid configuration:', error);
      throw new Error('Failed to update Plaid configuration');
    }
  }
}