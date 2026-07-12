import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';
process.env.CORS_ORIGIN = 'http://localhost:4000';

let capturedResetUrl = null;

vi.mock('../email.js', () => ({
  sendPasswordResetEmail: vi.fn((to, resetUrl) => {
    capturedResetUrl = resetUrl;
    return Promise.resolve({ success: true });
  }),
}));

const { buildApp } = await import('../server.js');
const { pool, initializeDatabase } = await import('../db.js');

let app;
const email = `authkit_test_${Date.now()}@example.test`;
const password = 'Str0ng!Pass';

beforeAll(async () => {
  await initializeDatabase();
  app = buildApp();
});

beforeEach(() => {
  capturedResetUrl = null;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['authkit_test_%@example.test']);
  await pool.end();
});

describe('registration', () => {
  it('rejects a weak password', async () => {
    const res = await request(app).post('/api/auth/register').send({ email, password: 'weak' });
    expect(res.status).toBe(400);
  });

  it('creates an account and sets a session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({ email, password, name: 'Test User' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/authkit_jwt=/);
  });

  it('rejects a duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({ email, password });
    expect(res.status).toBe(409);
  });
});

describe('login', () => {
  it('rejects an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password });
    expect(res.status).toBe(401);
  });

  it('rejects the wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password!1' });
    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials and can fetch /me', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
  });
});

describe('returnTo redirect', () => {
  it('echoes back a safe returnTo on login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password, returnTo: 'http://localhost:3002/pro' });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe('http://localhost:3002/pro');
  });

  it('echoes back a safe returnTo on register', async () => {
    const otherEmail = `authkit_test_returnto_${Date.now()}@example.test`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: otherEmail, password, returnTo: 'http://localhost:3002/admin' });
    expect(res.status).toBe(201);
    expect(res.body.redirectTo).toBe('http://localhost:3002/admin');
  });

  it('rejects an off-host returnTo (open-redirect protection)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password, returnTo: 'https://evil.example.com/steal' });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBeNull();
  });

  it('rejects a malformed returnTo without erroring', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password, returnTo: 'not a url' });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBeNull();
  });

  it('omits returnTo entirely without erroring', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBeNull();
  });

  it('in production, accepts https://*.flowgateway.dev and rejects everything else', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const good = await request(app)
        .post('/api/auth/login')
        .send({ email, password, returnTo: 'https://book.flowgateway.dev/pro' });
      expect(good.body.redirectTo).toBe('https://book.flowgateway.dev/pro');

      const wrongHost = await request(app)
        .post('/api/auth/login')
        .send({ email, password, returnTo: 'https://flowgateway.dev.evil.com/pro' });
      expect(wrongHost.body.redirectTo).toBeNull();

      const wrongProtocol = await request(app)
        .post('/api/auth/login')
        .send({ email, password, returnTo: 'http://book.flowgateway.dev/pro' });
      expect(wrongProtocol.body.redirectTo).toBeNull();

      const localhostRejectedInProd = await request(app)
        .post('/api/auth/login')
        .send({ email, password, returnTo: 'http://localhost:3002/pro' });
      expect(localhostRejectedInProd.body.redirectTo).toBeNull();
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });
});

describe('session cookie', () => {
  it('has no Domain attribute when COOKIE_DOMAIN is unset (dev/test default)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    const cookie = res.headers['set-cookie']?.[0];
    expect(cookie).toMatch(/authkit_jwt=/);
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });

  it('sets Domain=.flowgateway.dev when COOKIE_DOMAIN is configured, so book.flowgateway.dev can read it', async () => {
    process.env.COOKIE_DOMAIN = '.flowgateway.dev';
    try {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      const cookie = res.headers['set-cookie']?.[0];
      expect(cookie.toLowerCase()).toContain('domain=.flowgateway.dev');
    } finally {
      delete process.env.COOKIE_DOMAIN;
    }
  });
});

describe('session protection', () => {
  it('rejects /me without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('logout clears the session so /me is rejected again', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password });
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('revokes the JWT server-side on logout, so a copied token stops working immediately (not just an expired-cookie client)', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    const rawCookie = loginRes.headers['set-cookie'][0];
    const jwtValue = rawCookie.split(';')[0]; // "authkit_jwt=<token>"

    // Replaying the raw token still works before logout.
    expect((await request(app).get('/api/auth/me').set('Cookie', jwtValue)).status).toBe(200);

    await request(app).post('/api/auth/logout').set('Cookie', jwtValue);

    // The same raw token — captured before the client ever saw the
    // clear-cookie response — must now be rejected server-side.
    expect((await request(app).get('/api/auth/me').set('Cookie', jwtValue)).status).toBe(401);
  });
});

describe('forgot / reset password', () => {
  it('always responds success, even for an unknown email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.test' });
    expect(res.status).toBe(200);
    expect(capturedResetUrl).toBeNull();
  });

  it('issues a reset link for a known email and the token resets the password', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);
    expect(capturedResetUrl).toContain('/reset-password.html');

    const url = new URL(capturedResetUrl);
    const token = url.searchParams.get('token');
    const newPassword = 'Ev3nStr0nger!';

    const resetRes = await request(app).post('/api/auth/reset-password').send({ email, token, newPassword });
    expect(resetRes.status).toBe(200);

    // Old password no longer works, new one does.
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password: newPassword })).status).toBe(200);
  });

  it('rejects a reused reset token', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email });
    const url = new URL(capturedResetUrl);
    const token = url.searchParams.get('token');

    const first = await request(app)
      .post('/api/auth/reset-password')
      .send({ email, token, newPassword: 'FirstReset!9' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/reset-password')
      .send({ email, token, newPassword: 'SecondReset!9' });
    expect(second.status).toBe(400);
  });
});

describe('rate limiting (production behavior)', () => {
  // The limiters read process.env.NODE_ENV per-request and are skipped
  // outside production so local dev / this suite aren't throttled — flip it
  // on briefly to prove the limiter itself actually engages in prod.
  it('throttles repeated login attempts once NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    try {
      let lastStatus;
      for (let i = 0; i < 21; i++) {
        lastStatus = (
          await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'x' })
        ).status;
      }
      expect(lastStatus).toBe(429);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  }, 20_000);
});
