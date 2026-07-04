import { FakeMessagingPort } from '@marketplace/core';
import { describe, expect, it } from 'vitest';
import { ChannelRouterMessagingPort } from './channel-router.js';
import { EmailAdapter } from './resend-email.js';
import { fakeFetch } from './test-helpers.js';
import { TelegramAdapter } from './telegram-stub.js';
import { WaGatewayMessagingAdapter } from './wa-gateway-messaging.js';

describe('EmailAdapter (Resend)', () => {
  it('sends email with first line as subject', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: { id: 'email-1' } }]);
    const adapter = new EmailAdapter({ apiKey: 're_key', from: 'Marketplace <no-reply@example.com>' }, fetchFn);

    const result = await adapter.send({
      channel: 'EMAIL',
      recipient: 'client@example.com',
      body: 'Your session R4X2 is confirmed.\nSee you there.',
    });

    expect(result).toEqual({ providerMessageId: 'email-1' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.headers.authorization).toBe('Bearer re_key');
    expect(calls[0]!.body).toEqual({
      from: 'Marketplace <no-reply@example.com>',
      to: 'client@example.com',
      subject: 'Your session R4X2 is confirmed.',
      text: 'Your session R4X2 is confirmed.\nSee you there.',
    });
  });

  it('refuses non-EMAIL channels', async () => {
    const adapter = new EmailAdapter({ apiKey: 'k', from: 'x@example.com' }, fakeFetch([{ body: {} }]).fetchFn);
    await expect(adapter.send({ channel: 'WHATSAPP', recipient: '+254700000000', body: 'hi' })).rejects.toThrow(
      'cannot send channel WHATSAPP',
    );
  });
});

describe('WaGatewayMessagingAdapter', () => {
  it('POSTs to the gateway /send with the shared secret', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: { messageId: 'wa-1' } }]);
    const adapter = new WaGatewayMessagingAdapter({ baseUrl: 'http://gateway:3001', sharedSecret: 's3cret-s3cret-s3cret' }, fetchFn);

    const result = await adapter.send({ channel: 'WHATSAPP', recipient: '+254700000001', body: 'hello' });

    expect(result).toEqual({ providerMessageId: 'wa-1' });
    expect(calls[0]!.url).toBe('http://gateway:3001/send');
    expect(calls[0]!.headers['x-internal-secret']).toBe('s3cret-s3cret-s3cret');
    expect(calls[0]!.body).toEqual({ recipient: '+254700000001', body: 'hello' });
  });

  it('refuses non-WHATSAPP channels', async () => {
    const adapter = new WaGatewayMessagingAdapter({ baseUrl: 'http://g', sharedSecret: 's' }, fakeFetch([{ body: {} }]).fetchFn);
    await expect(adapter.send({ channel: 'EMAIL', recipient: 'a@b.c', body: 'hi' })).rejects.toThrow(
      'cannot send channel EMAIL',
    );
  });
});

describe('TelegramAdapter stub', () => {
  it('fails loudly so outbox rows surface as FAILED instead of vanishing', async () => {
    await expect(new TelegramAdapter().send({ channel: 'TELEGRAM', recipient: '@x', body: 'hi' })).rejects.toThrow(
      'not implemented',
    );
  });
});

describe('ChannelRouterMessagingPort', () => {
  it('routes by channel and rejects unconfigured channels', async () => {
    const whatsapp = new FakeMessagingPort();
    const email = new FakeMessagingPort();
    const router = new ChannelRouterMessagingPort({ WHATSAPP: whatsapp, EMAIL: email });

    await router.send({ channel: 'WHATSAPP', recipient: '+254700000001', body: 'wa' });
    await router.send({ channel: 'EMAIL', recipient: 'a@b.c', body: 'mail' });

    expect(whatsapp.sent.map((m) => m.body)).toEqual(['wa']);
    expect(email.sent.map((m) => m.body)).toEqual(['mail']);
    await expect(router.send({ channel: 'TELEGRAM', recipient: '@x', body: 'tg' })).rejects.toThrow(
      'No messaging adapter configured for channel TELEGRAM',
    );
  });
});
