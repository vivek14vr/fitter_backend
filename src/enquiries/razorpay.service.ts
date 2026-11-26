import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

type RazorpayOrderResponse = {
  id?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
};

const RAZORPAY_REQUEST_TIMEOUT_MS = 12_000;

export type RazorpayCheckoutOrder = {
  id: string;
  amount: number;
  currency: 'INR';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function verifyHmacSha256(payload: string | Buffer, signature: string, secret: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(signature) || !secret) return false;

  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  isCheckoutConfigured() {
    return Boolean(this.keyId && this.keySecret);
  }

  getCheckoutKeyId() {
    if (!this.isCheckoutConfigured()) {
      throw new ServiceUnavailableException('India payment checkout is not configured yet');
    }
    return this.keyId;
  }

  async createOrder(input: { amount: number; receipt: string; notes: Record<string, string> }) {
    const keyId = this.getCheckoutKeyId();
    const keySecret = this.keySecret;
    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        signal: AbortSignal.timeout(RAZORPAY_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: input.amount,
          currency: 'INR',
          receipt: input.receipt,
          notes: input.notes,
        }),
      });
    } catch (error) {
      this.logger.error(JSON.stringify({
        event: 'razorpay.order.create_failed',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      }));
      throw new ServiceUnavailableException('Payment provider is temporarily unavailable');
    }

    const responseBody: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(responseBody)) {
      this.logger.error(JSON.stringify({
        event: 'razorpay.order.rejected',
        statusCode: response.status,
      }));
      throw new ServiceUnavailableException('Payment provider could not create an order');
    }

    const order = responseBody as RazorpayOrderResponse;
    if (
      typeof order.id !== 'string'
      || !/^order_[A-Za-z0-9]+$/.test(order.id)
      || order.amount !== input.amount
      || order.currency !== 'INR'
    ) {
      this.logger.error(JSON.stringify({ event: 'razorpay.order.invalid_response' }));
      throw new ServiceUnavailableException('Payment provider returned an invalid order');
    }

    return { id: order.id, amount: order.amount, currency: order.currency } satisfies RazorpayCheckoutOrder;
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
    const keySecret = this.keySecret;
    return Boolean(keySecret && verifyHmacSha256(`${orderId}|${paymentId}`, signature, keySecret));
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    return Boolean(webhookSecret && verifyHmacSha256(rawBody, signature, webhookSecret));
  }

  isWebhookConfigured() {
    return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim());
  }

  private get keyId() {
    return process.env.RAZORPAY_KEY_ID?.trim() ?? '';
  }

  private get keySecret() {
    return process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
  }
}
