import { verifySession, COOKIE_NAME } from './jwt.js';
import { query } from './db.js';

export async function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  let decoded;
  try {
    decoded = verifySession(token);
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  try {
    if (decoded.jti) {
      const revoked = await query('SELECT 1 FROM revoked_tokens WHERE jti = $1', [decoded.jti]);
      if (revoked.rows.length > 0) {
        return res.status(401).json({ error: 'Session has been signed out. Please log in again.' });
      }
    }
  } catch (err) {
    return next(err);
  }

  req.user = { id: decoded.sub, email: decoded.email };
  req.tokenClaims = decoded;
  next();
}

// Central error handler — never leak stack traces or DB internals to the
// client; log the real error server-side.
export function errorHandler(err, req, res, _next) {
  console.error('[authkit-service] Unhandled error:', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
}
