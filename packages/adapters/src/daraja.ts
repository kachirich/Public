import type { InitPaymentInput, PaymentsPort } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  /** Paybill / till number (BusinessShortCode). */
  shortcode: string;
  /** Lipa na M-Pesa Online passkey for the shortcode. */
  passkey: string;
  /** Public URL Daraja POSTs the STK result to (our /webhooks/mpesa). */
  callbackUrl: string;
  /** https://sandbox.safaricom.co.ke or https://api.safaricom.co.ke */
  baseUrl?: string;
  /** Where the payer lands while waiting for the STK prompt (request status page). */
  statusUrlBase?: string;
}

// Safaricom Daraja — Lipa na M-Pesa Online (STK Push). Unlike redirect
// providers there is no checkout page: we push a PIN prompt to the client's
// phone and the "authorizationUrl" just returns them to the request status
// page, which polls until the callback lands. providerRef is Daraja's
// CheckoutRequestID — the only id the async callback echoes back.
export class DarajaAdapter implements PaymentsPort {
  private readonly baseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: DarajaConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.baseUrl = config.baseUrl ?? 'https://sandbox.safaricom.co.ke';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now().getTime() + 30_000) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    const res = await this.fetchFn(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { authorization: `Basic ${basic}` },
    });
    const body = (await expectOk('daraja', res)) as { access_token: string; expires_in: string | number };
    this.token = { value: body.access_token, expiresAt: this.now().getTime() + Number(body.expires_in) * 1000 };
    return this.token.value;
  }

  async initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }> {
    if (!input.clientPhone) {
      throw new Error('M-Pesa payments need the client\'s phone number (ask for it on the booking form)');
    }
    const phone = normalizeMsisdn(input.clientPhone);
    const timestamp = darajaTimestamp(this.now());
    const password = Buffer.from(`${this.config.shortcode}${this.config.passkey}${timestamp}`).toString('base64');

    const res = await this.fetchFn(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: this.config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: toWholeShillings(input.amount),
        PartyA: phone,
        PartyB: this.config.shortcode,
        PhoneNumber: phone,
        CallBackURL: this.config.callbackUrl,
        AccountReference: 'PROACCESS', // ≤12 chars; the real link is CheckoutRequestID
        TransactionDesc: `Booking ${input.requestId.slice(0, 8)}`,
      }),
    });
    const body = (await expectOk('daraja', res)) as { CheckoutRequestID: string; ResponseCode: string };
    if (body.ResponseCode !== '0') throw new Error(`daraja: STK push rejected (code ${body.ResponseCode})`);
    const statusBase = this.config.statusUrlBase ?? '';
    return {
      authorizationUrl: `${statusBase}/requests/${input.requestId}?payment=stk-sent`,
      providerRef: body.CheckoutRequestID,
    };
  }

  // Reversals on Daraja need separate initiator credentials and an approval
  // flow; wire them per deployment. Failing loudly keeps refunds visible in
  // the dead-letter queue instead of silently swallowed.
  async refund(providerRef: string, amount: string): Promise<{ refundRef: string }> {
    throw new Error(
      `daraja: automatic reversal not configured — refund ${amount} for ${providerRef} via the M-Pesa portal, then record it manually`,
    );
  }

  // Daraja callbacks are not signed; authenticity comes from the secret
  // callback path token checked by the webhook route, not from this method.
  verifyWebhookSignature(): boolean {
    return false;
  }
}

/** 07XX / +2547XX / 2547XX → 2547XX (Daraja wants digits, country-coded). */
export function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  throw new Error(`Cannot normalize phone number for M-Pesa: ${phone}`);
}

/** Daraja wants whole shillings; reject amounts that would lose cents. */
export function toWholeShillings(amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid money amount: ${amount}`);
  return Math.ceil(n);
}

export function darajaTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
