const crypto = require('crypto');

const COOKIE_NAME = 'ump_session';

function getSessionSecret() {
  return String(process.env.SESSION_SECRET || 'change-this-session-secret').trim();
}

function getSessionTtlMs() {
  const raw = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60 * 60 * 1000;
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createSessionToken(userId) {
  const payload = {
    userId: String(userId).trim(),
    exp: Date.now() + getSessionTtlMs(),
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, providedSignature] = parts;
  const expectedSignature = sign(encoded);

  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.userId || !payload?.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req?.headers?.cookie;
  if (!header) return {};

  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index <= 0) return acc;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function buildCookie(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function setSessionCookie(res, userId) {
  const token = createSessionToken(userId);
  const maxAgeSeconds = Math.floor(getSessionTtlMs() / 1000);
  res.setHeader('Set-Cookie', buildCookie(token, maxAgeSeconds));
}

function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function getSessionUserId(req) {
  const cookies = parseCookies(req);
  const payload = verifySessionToken(cookies[COOKIE_NAME]);
  return payload?.userId ? String(payload.userId).trim() : null;
}

module.exports = {
  COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  getSessionUserId,
};
