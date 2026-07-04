import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AdapterHttpError } from './http.js';
import { PaystackAdapter, toSubunits } from './paystack.js';
import { fakeFetch } from './test-helpers.js';

const CONFIG = { secretKey: 'sk_test_abc', callbackUrl: 'https://app.example/pay/done' };

describe('toSubunits', () => {
  it('converts decimal strings to integer subunits without float math', () => {
    expect(toSubunits('1000.00')).toBe(100000);
    expect(toSubunits('850.5')).toBe(85050);
    expect(toSubunits('0.01')).toBe(1);
    expect(toSubunits('19.99')).toBe(1999);
    expect(toSubunits('7')).toBe(700);
  });

  it('rejects malformed amounts', () => {
    expect(() => toSubunits('10.999')).toThrow();
    expect(() => toSubunits('-5.00')).toThrow();
    expect(() => toSubunits('abc')).toThrow();
  });
});

describe('PaystackAdapter', () => {
  it('initPayment posts the right payload and maps the response', async () => {
    const { fetchFn, calls } = fakeFetch([
      { body: { status: true, data: { authorization_url: 'https://checkout.paystack.com/x1', reference: 'req-abc' } } },
    ]);
    const adapter = new PaystackAdapter(CONFIG, fetchFn);

    const result = await adapter.initPayment({
      requestId: 'abc',
      amount: '1000.00',
      currency: 'KES',
      clientEmail: 'client@example.com',
    });

    expect(result).toEqual({ authorizationUrl: 'https://checkout.paystack.com/x1', providerRef: 'req-abc' });
    expect(calls[0]!.url).toBe('https://api.paystack.co/transaction/initialize');
    expect(calls[0]!.headers.authorization).toBe('Bearer sk_test_abc');
    expect(calls[0]!.body).toEqual({
      email: 'client@example.com',
      amount: 100000,
      currency: 'KES',
      reference: 'req-abc',
      callback_url: 'https://app.example/pay/done',
      metadata: { request_id: 'abc' },
    });
  });

  it('refund posts subunits against the original transaction', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: { status: true, data: { id: 42 } } }]);
    const adapter = new PaystackAdapter(CONFIG, fetchFn);

    const result = await adapter.refund('req-abc', '250.00');

    expect(result).toEqual({ refundRef: '42' });
    expect(calls[0]!.url).toBe('https://api.paystack.co/refund');
    expect(calls[0]!.body).toEqual({ transaction: 'req-abc', amount: 25000 });
  });

  it('non-2xx responses raise AdapterHttpError', async () => {
    const { fetchFn } = fakeFetch([{ status: 401, body: { message: 'Invalid key' } }]);
    const adapter = new PaystackAdapter(CONFIG, fetchFn);
    await expect(adapter.refund('x', '1.00')).rejects.toThrow(AdapterHttpError);
  });

  it('verifies real HMAC-SHA512 webhook signatures and rejects tampering', () => {
    const adapter = new PaystackAdapter(CONFIG);
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference: 'req-abc' } });
    const signature = createHmac('sha512', CONFIG.secretKey).update(rawBody).digest('hex');

    expect(adapter.verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(adapter.verifyWebhookSignature(rawBody + ' ', signature)).toBe(false);
    expect(adapter.verifyWebhookSignature(rawBody, signature.replace(/^./, '0'))).toBe(false);
    expect(adapter.verifyWebhookSignature(rawBody, 'short')).toBe(false);
  });
});
