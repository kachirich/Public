import { describe, expect, it } from 'vitest';
import { DarajaAdapter, darajaTimestamp, normalizeMsisdn, toWholeShillings } from './daraja.js';
import { fakeFetch } from './test-helpers.js';

const CONFIG = {
  consumerKey: 'ck',
  consumerSecret: 'cs',
  shortcode: '174379',
  passkey: 'passkey',
  callbackUrl: 'https://api.example/webhooks/mpesa/tok',
  statusUrlBase: 'https://app.example',
};

const NOW = new Date('2026-07-05T09:30:00');

describe('normalizeMsisdn', () => {
  it('country-codes the common Kenyan formats', () => {
    expect(normalizeMsisdn('+254712345678')).toBe('254712345678');
    expect(normalizeMsisdn('254712345678')).toBe('254712345678');
    expect(normalizeMsisdn('0712345678')).toBe('254712345678');
    expect(normalizeMsisdn('712 345 678')).toBe('254712345678');
  });

  it('rejects numbers it cannot interpret', () => {
    expect(() => normalizeMsisdn('44771234')).toThrow();
  });
});

describe('toWholeShillings', () => {
  it('rounds up so the platform never undercollects', () => {
    expect(toWholeShillings('2000.00')).toBe(2000);
    expect(toWholeShillings('50.01')).toBe(51);
  });

  it('rejects non-positive amounts', () => {
    expect(() => toWholeShillings('0')).toThrow();
    expect(() => toWholeShillings('nope')).toThrow();
  });
});

describe('darajaTimestamp', () => {
  it('formats local time as YYYYMMDDHHmmss', () => {
    expect(darajaTimestamp(NOW)).toBe('20260705093000');
  });
});

describe('DarajaAdapter.initPayment', () => {
  it('fetches a token then STK-pushes with the derived password', async () => {
    const { fetchFn, calls } = fakeFetch([
      { body: { access_token: 'tok123', expires_in: '3599' } },
      { body: { CheckoutRequestID: 'ws_CO_1', ResponseCode: '0', ResponseDescription: 'ok' } },
    ]);
    const adapter = new DarajaAdapter(CONFIG, fetchFn, () => NOW);
    const result = await adapter.initPayment({
      requestId: 'abc-123',
      amount: '2000.00',
      currency: 'KES',
      clientEmail: 'c@example.com',
      clientPhone: '0712345678',
    });

    expect(result.providerRef).toBe('ws_CO_1');
    expect(result.authorizationUrl).toBe('https://app.example/requests/abc-123?payment=stk-sent');

    expect(calls[0]!.url).toContain('/oauth/v1/generate');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('ck:cs').toString('base64')}`);

    const push = calls[1]!;
    expect(push.url).toContain('/mpesa/stkpush/v1/processrequest');
    expect(push.headers.authorization).toBe('Bearer tok123');
    const body = push.body as Record<string, unknown>;
    expect(body.PhoneNumber).toBe('254712345678');
    expect(body.Amount).toBe(2000);
    expect(body.Password).toBe(Buffer.from(`174379passkey20260705093000`).toString('base64'));
    expect(body.CallBackURL).toBe(CONFIG.callbackUrl);
  });

  it('requires a client phone', async () => {
    const { fetchFn } = fakeFetch([{ body: {} }]);
    const adapter = new DarajaAdapter(CONFIG, fetchFn, () => NOW);
    await expect(
      adapter.initPayment({ requestId: 'r', amount: '10', currency: 'KES', clientEmail: 'c@e.com' }),
    ).rejects.toThrow(/phone/);
  });

  it('reuses a cached token until near expiry', async () => {
    const { fetchFn, calls } = fakeFetch([
      { body: { access_token: 'tok123', expires_in: '3599' } },
      { body: { CheckoutRequestID: 'a', ResponseCode: '0' } },
      { body: { CheckoutRequestID: 'b', ResponseCode: '0' } },
    ]);
    const adapter = new DarajaAdapter(CONFIG, fetchFn, () => NOW);
    const input = { requestId: 'r', amount: '10', currency: 'KES', clientEmail: 'c@e.com', clientPhone: '0712345678' };
    await adapter.initPayment(input);
    await adapter.initPayment(input);
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth/'));
    expect(tokenCalls).toHaveLength(1);
  });
});

describe('DarajaAdapter.refund', () => {
  it('fails loudly so refunds are handled manually until reversal is wired', async () => {
    const { fetchFn } = fakeFetch([{ body: {} }]);
    const adapter = new DarajaAdapter(CONFIG, fetchFn, () => NOW);
    await expect(adapter.refund('ws_CO_1', '100')).rejects.toThrow(/reversal not configured/);
  });
});
