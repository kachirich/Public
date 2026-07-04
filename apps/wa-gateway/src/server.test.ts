import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('GET /health', () => {
  it('reports ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'wa-gateway' });
  });
});
