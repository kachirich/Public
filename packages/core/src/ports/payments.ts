export interface InitPaymentInput {
  requestId: string;
  amount: string;
  currency: string;
  clientEmail: string;
  /** E.164; required by push-based providers (M-Pesa STK), unused by redirect ones. */
  clientPhone?: string;
}

export interface PaymentsPort {
  initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }>;
  refund(providerRef: string, amount: string): Promise<{ refundRef: string }>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}
