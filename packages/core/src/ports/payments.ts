export interface InitPaymentInput {
  requestId: string;
  amount: string;
  currency: string;
  clientEmail: string;
}

export interface PaymentsPort {
  initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }>;
  refund(providerRef: string, amount: string): Promise<{ refundRef: string }>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}
