import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from './db.js';
import { signSession, verifySession, setSessionCookie, clearSessionCookie, COOKIE_NAME } from './jwt.js';
import { authenticate } from './middleware.js';
import { sendPasswordResetEmail } from './email.js';
import { authLimiter, passwordResetLimiter } from './rateLimit.js';
import { safeReturnTo } from './returnTo.js';

const router = Router();

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

// Precomputed hash used when a user isn't found, so login always pays the
// same bcrypt cost — keeps response timing constant and avoids leaking
// account existence through a timing side-channel.
const DUMMY_HASH = bcrypt.hashSync('authkit-timing-safety-placeholder', SALT_ROUNDS);

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { password, name } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long and contain at least one number and one special character.',
      });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const inserted = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, passwordHash, typeof name === 'string' ? name.trim().slice(0, 200) || null : null],
    );
    const user = inserted.rows[0];

    const token = signSession(user);
    setSessionCookie(res, token);
    return res.status(201).json({ success: true, user: publicUser(user), redirectTo: safeReturnTo(req.body?.returnTo) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query(
      'SELECT id, email, password_hash, name, created_at FROM users WHERE email = $1',
      [email],
    );
    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signSession(user);
    setSessionCookie(res, token);
    return res.json({ success: true, user: publicUser(user), redirectTo: safeReturnTo(req.body?.returnTo) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const decoded = verifySession(token);
        if (decoded.jti) {
          await query(
            'INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
            [decoded.jti, new Date(decoded.exp * 1000)],
          );
        }
      } catch {
        // Token already invalid/expired — nothing to revoke, fall through to clearing the cookie.
      }
    }
    clearSessionCookie(res);
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', passwordResetLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    // Always respond with the same generic message, whether or not the
    // account exists, so this endpoint can't be used to enumerate emails.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await query(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS)],
      );

      const base = process.env.AUTHKIT_BASE_URL || 'http://localhost:4000';
      const resetUrl = `${base}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(email)}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    return res.json({
      success: true,
      message: 'If an account exists with that email, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', passwordResetLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { token, newPassword } = req.body || {};

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: 'Email, token, and new password are required' });
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long and contain at least one number and one special character.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await query(
      `SELECT pr.id, pr.user_id FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = $1 AND u.email = $2 AND pr.expires_at > NOW()`,
      [tokenHash, email],
    );
    const reset = result.rows[0];
    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      reset.user_id,
    ]);
    // Single-use: burn every outstanding reset token for this user, not just
    // the one that was redeemed.
    await query('DELETE FROM password_resets WHERE user_id = $1', [reset.user_id]);

    return res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    next(err);
  }
});

export default router;
