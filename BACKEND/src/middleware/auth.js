const jwt = require('jsonwebtoken');
const authModel = require('../modules/auth/auth.model');

function getJwtSecret() {
  return String(process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || '').trim();
}

async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, bearerToken] = header.split(' ');
    const cookieToken = String(req.cookies?.access_token || '').trim();
    const token = cookieToken || (scheme === 'Bearer' ? bearerToken : '');

    if (!token) {
      return res.status(401).json({ success: false, message: 'Missing authentication token' });
    }

    const secret = getJwtSecret();
    if (!secret) {
      return res.status(500).json({ success: false, message: 'JWT_SECRET not configured' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (_e) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const userId = String(decoded?.sub || decoded?.user_id || '').trim();
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Token payload invalid' });
    }

    const session = await authModel.getSessionToken(userId);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session not found. Please login again.' });
    }

    const nowMs = Date.now();
    const dbExpiryMs = new Date(session.expires_at).getTime();

    if (
      session.revoked_at ||
      !Number.isFinite(dbExpiryMs) ||
      nowMs > dbExpiryMs
    ) {
      await authModel.clearSession(userId);
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
    }

    await authModel.touchSession(userId);
    req.user = decoded;
    req.authToken = token;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = authenticateToken;
