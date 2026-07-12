import rateLimit from 'express-rate-limit';

// Rate limiters are in-memory (per-instance). This service is designed to
// run as a single small process; if it is ever scaled horizontally, swap
// the default store for a shared one (e.g. rate-limit-redis) so limits are
// enforced across instances.
//
// Skipped outside production so local dev and the automated test suite
// aren't throttled by real limits.
const skipInNonProd = () => process.env.NODE_ENV !== 'production';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInNonProd,
  message: { error: 'Too many attempts. Please try again later.' },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInNonProd,
  message: { error: 'Too many password reset requests. Please try again later.' },
});
