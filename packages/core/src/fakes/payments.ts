import type { InitPaymentInput, PaymentsPort } from '../ports/payments.js';

// In-memory PaymentsPort recording every init and refund.
export class FakePaymentsPort implements PaymentsPort {
  readonly inits: (InitPaymentInput & { providerRef: string })[] = [];
  readonly refunds: { providerRef: string; amount: string; refundRef: string }[] = [];
  validSignature = 'valid-signature';

  async initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }> {
    const providerRef = `fake-pay-${this.inits.length + 1}`;
    this.inits.push({ ...input, providerRef });
    return { authorizationUrl: `https://pay.example/${providerRef}`, providerRef };
  }

  async refund(providerRef: string, amount: string): Promise<{ refundRef: string }> {
    const refundRef = `fake-refund-${this.refunds.length + 1}`;
    this.refunds.push({ providerRef, amount, refundRef });
    return { refundRef };
  }

  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === this.validSignature;
  }
}
