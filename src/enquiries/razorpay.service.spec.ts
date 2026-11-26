import { createHmac } from 'node:crypto';
import { verifyHmacSha256 } from './razorpay.service.js';

describe('Razorpay signature verification', () => {
  it('accepts a valid HMAC-SHA256 signature', () => {
    const payload = 'order_example|pay_example';
    const secret = 'test-secret';
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyHmacSha256(payload, signature, secret)).toBe(true);
  });

  it('rejects tampered payment data or signatures', () => {
    const payload = 'order_example|pay_example';
    const secret = 'test-secret';
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyHmacSha256(`${payload}-tampered`, signature, secret)).toBe(false);
    expect(verifyHmacSha256(payload, 'not-a-signature', secret)).toBe(false);
  });
});
