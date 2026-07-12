// Open-redirect protection: a client-supplied returnTo is never trusted
// directly. This is the one place that decides what's safe to redirect to
// after login/register — callers must run every returnTo through here and
// use the result (or a hardcoded fallback), never the raw input.
const PROD_SUFFIX = process.env.RETURN_TO_HOST_SUFFIX || 'flowgateway.dev';

export function safeReturnTo(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (process.env.NODE_ENV === 'production') {
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== PROD_SUFFIX && !url.hostname.endsWith(`.${PROD_SUFFIX}`)) return null;
  } else {
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return null;
  }
  return url.toString();
}
