import { describe, expect, it } from 'vitest';
import { OpenWaClient, toChatId, type FetchLike } from './openwa.js';
import { buildServer } from './server.js';

const SECRET = 'test-shared-secret-16chars';

interface Recorded {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeFetch(status = 200, responseBody: unknown = {}): { fetchFn: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn, calls };
}

function makeApp(openwaFetch: FetchLike, orchestratorFetch: FetchLike) {
  const openwa = new OpenWaClient({ baseUrl: 'http://openwa:2785' }, openwaFetch);
  return buildServer({
    openwa,
    orchestratorBaseUrl: 'http://orchestrator:3000',
    sharedSecret: SECRET,
    fetchFn: orchestratorFetch,
  });
}

describe('GET /health', () => {
  it('reports ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'wa-gateway' });
  });
});

describe('toChatId', () => {
  it('converts E.164 to OpenWA chat ids', () => {
    expect(toChatId('+254712345678')).toBe('254712345678@c.us');
    expect(toChatId('254712345678')).toBe('254712345678@c.us');
  });
});

describe('POST /send', () => {
  it('rejects a missing or wrong shared secret', async () => {
    const app = makeApp(fakeFetch().fetchFn, fakeFetch().fetchFn);

    const noAuth = await app.inject({
      method: 'POST',
      url: '/send',
      payload: { recipient: '+254712345678', body: 'hi' },
    });
    expect(noAuth.statusCode).toBe(401);

    const badAuth = await app.inject({
      method: 'POST',
      url: '/send',
      headers: { 'x-internal-secret': 'wrong' },
      payload: { recipient: '+254712345678', body: 'hi' },
    });
    expect(badAuth.statusCode).toBe(401);
  });

  it('forwards the text to OpenWA sendText and returns the message id', async () => {
    const openwa = fakeFetch(200, { success: true, response: 'true_254712345678@c.us_ABCD' });
    const app = makeApp(openwa.fetchFn, fakeFetch().fetchFn);

    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: { 'x-internal-secret': SECRET },
      payload: { recipient: '+254712345678', body: 'New session request #R4X2' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ messageId: 'true_254712345678@c.us_ABCD' });
    expect(openwa.calls[0]!.url).toBe('http://openwa:2785/sendText');
    expect(openwa.calls[0]!.body).toEqual({
      args: { to: '254712345678@c.us', content: 'New session request #R4X2' },
    });
  });

  it('validates the payload', async () => {
    const app = makeApp(fakeFetch().fetchFn, fakeFetch().fetchFn);
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      headers: { 'x-internal-secret': SECRET },
      payload: { recipient: '+254712345678' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /webhook/openwa', () => {
  it('forwards onMessage events to the orchestrator with the shared secret', async () => {
    const orchestrator = fakeFetch(200, { ok: true });
    const app = makeApp(fakeFetch().fetchFn, orchestrator.fetchFn);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/openwa',
      payload: {
        event: 'onMessage',
        data: { id: 'wa-msg-1', from: '254712345678@c.us', body: '1' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forwarded: true });
    expect(orchestrator.calls[0]!.url).toBe('http://orchestrator:3000/internal/wa-inbound');
    expect(orchestrator.calls[0]!.headers['x-internal-secret']).toBe(SECRET);
    expect(orchestrator.calls[0]!.body).toEqual({
      waMessageId: 'wa-msg-1',
      fromE164: '+254712345678',
      body: '1',
    });
  });

  it('acks-and-ignores non-message events without calling the orchestrator', async () => {
    const orchestrator = fakeFetch();
    const app = makeApp(fakeFetch().fetchFn, orchestrator.fetchFn);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/openwa',
      payload: { event: 'onBattery', data: { level: 90 } },
    });

    expect(res.statusCode).toBe(202);
    expect(orchestrator.calls).toHaveLength(0);
  });

  it('returns 502 when the orchestrator rejects, so OpenWA retries', async () => {
    const orchestrator = fakeFetch(500, { error: 'boom' });
    const app = makeApp(fakeFetch().fetchFn, orchestrator.fetchFn);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/openwa',
      payload: { event: 'onMessage', data: { id: 'wa-msg-2', from: '254700000000@c.us', body: 'ok' } },
    });

    expect(res.statusCode).toBe(502);
  });
});
