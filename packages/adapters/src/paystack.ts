import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InitPaymentInput, PaymentsPort } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';

export interface PaystackConfig {
  secretKey: string;
  baseUrl?: string;
  callbackUrl?: string;
}

// Paystack (card + M-Pesa). Amounts cross the wire in subunits (KES cents);
// everywhere else in the system money stays a decimal string.
export class PaystackAdapter implements PaymentsPort {
  private readonly baseUrl: string;

  constructor(
    private readonly config: PaystackConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {
    this.baseUrl = config.baseUrl ?? 'https://api.paystack.co';
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.secretKey}`,
      'content-type': 'application/json',
    };
  }

  async initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }> {
    const res = await this.fetchFn(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email: input.clientEmail,
        amount: toSubunits(input.amount),
        currency: input.currency,
        reference: `req-${input.requestId}`,
        callback_url: this.config.callbackUrl,
        metadata: { request_id: input.requestId },
      }),
    });
    const body = (await expectOk('paystack', res)) as {
      data: { authorization_url: string; reference: string };
    };
    return { authorizationUrl: body.data.authorization_url, providerRef: body.data.reference };
  }

  async refund(providerRef: string, amount: string): Promise<{ refundRef: string }> {
    const res = await this.fetchFn(`${this.baseUrl}/refund`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ transaction: providerRef, amount: toSubunits(amount) }),
    });
    const body = (await expectOk('paystack', res)) as { data: { id: number } };
    return { refundRef: String(body.data.id) };
  }

  // Paystack signs the raw body with HMAC-SHA512 of the secret key and puts
  // the hex digest in x-paystack-signature.
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha512', this.config.secretKey).update(rawBody).digest('hex');
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}

export function toSubunits(amount: string): number {
  const match = amount.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid money amount: ${amount}`);
  const whole = match[1]!;
  const frac = (match[2] ?? '').padEnd(2, '0');
  return Number(whole) * 100 + Number(frac);
}
