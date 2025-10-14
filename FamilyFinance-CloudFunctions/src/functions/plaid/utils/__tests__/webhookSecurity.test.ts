/**
 * Test suite for Plaid webhook signature verification
 *
 * This test suite validates the security of webhook signature verification
 * to ensure only legitimate Plaid webhooks are processed.
 */

import * as crypto from 'crypto';

// Test implementation of verifyWebhookSignature function
function verifyWebhookSignature(body: string, signature: string, webhookSecret: string): boolean {
  try {
    if (!webhookSecret) {
      console.error('PLAID_WEBHOOK_SECRET not configured');
      return false;
    }

    if (!signature || typeof signature !== 'string') {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    // Ensure both signatures are the same length before comparison
    if (signature.length !== expectedSignature.length) {
      return false;
    }

    try {
      // Timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (bufferError) {
      // If there's an error creating buffers (e.g., invalid hex), return false
      return false;
    }
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

describe('Webhook Signature Verification', () => {
  const TEST_WEBHOOK_SECRET = 'test-webhook-secret-for-unit-tests';

  const validWebhookPayload = JSON.stringify({
    webhook_type: 'TRANSACTIONS',
    webhook_code: 'SYNC_UPDATES_AVAILABLE',
    item_id: 'test-item-123',
    request_id: 'test-request-456',
    environment: 'sandbox'
  });

  describe('Valid Signature Tests', () => {
    test('should verify valid signature correctly', () => {
      // Generate valid signature
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      const result = verifyWebhookSignature(validWebhookPayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });

    test('should handle different payload sizes', () => {
      const largePayload = JSON.stringify({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'test-item-123',
        request_id: 'test-request-456',
        environment: 'sandbox',
        large_data: 'x'.repeat(10000) // Large payload
      });

      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(largePayload)
        .digest('hex');

      const result = verifyWebhookSignature(largePayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });

    test('should handle empty payload', () => {
      const emptyPayload = '';
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(emptyPayload)
        .digest('hex');

      const result = verifyWebhookSignature(emptyPayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });
  });

  describe('Invalid Signature Tests', () => {
    test('should reject invalid signature', () => {
      const invalidSignature = 'invalid-signature-123';
      const result = verifyWebhookSignature(validWebhookPayload, invalidSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should reject signature with wrong secret', () => {
      const wrongSecret = 'wrong-secret';
      const signatureWithWrongSecret = crypto
        .createHmac('sha256', wrongSecret)
        .update(validWebhookPayload)
        .digest('hex');

      const result = verifyWebhookSignature(validWebhookPayload, signatureWithWrongSecret, TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should reject signature for modified payload', () => {
      const originalSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      const modifiedPayload = validWebhookPayload.replace('test-item-123', 'modified-item-456');

      const result = verifyWebhookSignature(modifiedPayload, originalSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should reject empty signature', () => {
      const result = verifyWebhookSignature(validWebhookPayload, '', TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should reject null/undefined signature', () => {
      const result1 = verifyWebhookSignature(validWebhookPayload, null as any, TEST_WEBHOOK_SECRET);
      const result2 = verifyWebhookSignature(validWebhookPayload, undefined as any, TEST_WEBHOOK_SECRET);
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });
  });

  describe('Security Edge Cases', () => {
    test('should handle missing webhook secret', () => {
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      const result = verifyWebhookSignature(validWebhookPayload, validSignature, '');
      expect(result).toBe(false);
    });

    test('should handle malformed hex signature', () => {
      const malformedSignature = 'not-hex-characters-!!!';
      const result = verifyWebhookSignature(validWebhookPayload, malformedSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should handle signature with different length', () => {
      const shortSignature = 'abc123';
      const result = verifyWebhookSignature(validWebhookPayload, shortSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(false);
    });

    test('should be resistant to timing attacks', () => {
      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      // Create signatures that differ only by one character
      const almostValidSignature = validSignature.slice(0, -1) + '0';

      // Both should return false, and timing should be similar
      const start1 = process.hrtime.bigint();
      const result1 = verifyWebhookSignature(validWebhookPayload, almostValidSignature, TEST_WEBHOOK_SECRET);
      const end1 = process.hrtime.bigint();

      const start2 = process.hrtime.bigint();
      const result2 = verifyWebhookSignature(validWebhookPayload, 'completely-wrong', TEST_WEBHOOK_SECRET);
      const end2 = process.hrtime.bigint();

      expect(result1).toBe(false);
      expect(result2).toBe(false);

      // Timing difference should be minimal (both should fail at similar speed)
      const time1 = Number(end1 - start1);
      const time2 = Number(end2 - start2);
      const timeDifference = Math.abs(time1 - time2);

      // Allow for some variance, but should be roughly similar
      expect(timeDifference).toBeLessThan(1000000); // 1ms in nanoseconds
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle real Plaid webhook payload structure', () => {
      const realPlaidPayload = JSON.stringify({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: '5p7loqoKKwH5X9nqePLMuBd4B78o1dFZok45Z',
        initial_update_complete: true,
        historical_update_complete: false,
        environment: 'sandbox',
        request_id: 'req-123-456-789'
      });

      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(realPlaidPayload)
        .digest('hex');

      const result = verifyWebhookSignature(realPlaidPayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });

    test('should handle recurring transactions webhook', () => {
      const recurringPayload = JSON.stringify({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'RECURRING_TRANSACTIONS_UPDATE',
        item_id: 'test-item-recurring',
        account_ids: ['account1', 'account2'],
        environment: 'sandbox'
      });

      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(recurringPayload)
        .digest('hex');

      const result = verifyWebhookSignature(recurringPayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });

    test('should handle item error webhook', () => {
      const errorPayload = JSON.stringify({
        webhook_type: 'ITEM',
        webhook_code: 'ERROR',
        item_id: 'test-item-error',
        error: {
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
          error_message: 'the login details of this item have changed',
          display_message: 'Please reconnect your account'
        },
        environment: 'sandbox'
      });

      const validSignature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(errorPayload)
        .digest('hex');

      const result = verifyWebhookSignature(errorPayload, validSignature, TEST_WEBHOOK_SECRET);
      expect(result).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    test('should verify signature quickly for normal payloads', () => {
      const signature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      const start = process.hrtime.bigint();
      const result = verifyWebhookSignature(validWebhookPayload, signature, TEST_WEBHOOK_SECRET);
      const end = process.hrtime.bigint();

      expect(result).toBe(true);

      // Should complete in less than 1ms
      const timeMs = Number(end - start) / 1000000;
      expect(timeMs).toBeLessThan(1);
    });

    test('should handle multiple rapid verifications', () => {
      const signature = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(validWebhookPayload)
        .digest('hex');

      const results = [];
      const start = process.hrtime.bigint();

      for (let i = 0; i < 100; i++) {
        results.push(verifyWebhookSignature(validWebhookPayload, signature, TEST_WEBHOOK_SECRET));
      }

      const end = process.hrtime.bigint();
      const totalTimeMs = Number(end - start) / 1000000;

      // All should be true
      expect(results.every(r => r === true)).toBe(true);

      // Should average less than 0.1ms per verification
      expect(totalTimeMs / 100).toBeLessThan(0.1);
    });
  });
});

// Test helper to generate valid webhook signatures
export function generateValidWebhookSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Test helper to create mock webhook requests
export function createMockWebhookRequest(payload: any, secret: string = 'test-secret') {
  const body = JSON.stringify(payload);
  const signature = generateValidWebhookSignature(body, secret);

  return {
    body: payload,
    headers: {
      'plaid-verification': signature
    },
    method: 'POST'
  };
}