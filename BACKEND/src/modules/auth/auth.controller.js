const authModel = require('./auth.model');
const otpService = require('../../services/otp/otp-service');
const jwt = require('jsonwebtoken');
const activeRequestOtp = new Map();
const activeResend = new Map();

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getJwtSecret() {
  return String(process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || '').trim();
}

async function issueAccessToken(user) {
  const secret = getJwtSecret();
  if (!secret) {
    const err = new Error('JWT_SECRET not configured');
    err.status = 500;
    throw err;
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const payload = {
    sub: user.user_id,
    user_id: user.user_id,
    user_type: user.user_type,
    division: user.division_code,
    department: user.department,
  };

  const token = jwt.sign(payload, secret, { expiresIn });
  const decoded = jwt.decode(token);
  const expMs = Number(decoded?.exp || 0) * 1000;
  const expiresAt = new Date(expMs);

  await authModel.saveSessionToken(user.user_id, token, expiresAt);
  return token;
}

function toUserPayload(user) {
  if (!user) return null;

  return {
    user_id: user.user_id,
    user_name: user.user_name,
    railway: user.zone,
    division: user.division_code,
    department: user.department,
    user_type: user.user_type,
    unit_type: user.unit_type,
    email: user.email || '',
    mobile: user.contact_no || '',
  };
}

async function login(req, res, next) {
  try {
    const { user_id, password } = req.body || {};

    if (!user_id || !password) {
      const err = new Error('Missing user_id or password');
      err.status = 400;
      throw err;
    }

    const user = await authModel.findUserById(user_id);
    if (!user || user.password !== password) {
      const err = new Error('Invalid user_id or password');
      err.status = 401;
      throw err;
    }

    const accessToken = await issueAccessToken(user);

    res.json({
      success: true,
      accessToken,
      tokenType: 'Bearer',
      user: toUserPayload(user),
    });
  } catch (err) {
    next(err);
  }
}

async function requestOtp(req, res, next) {
  try {
    const { user_id, password } = req.body || {};

    if (!user_id || !password) {
      return res.status(400).json({ success: false, message: 'Missing user_id or password' });
    }

    const user = await authModel.findUserById(user_id);
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid user_id or password' });
    }

    const email = await authModel.getUserEmailById(user_id);
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not available for this user' });
    }

    const reuseSec = Number(process.env.OTP_REUSE_SECONDS || 60);
    const otpState = await authModel.getOtpState(user_id);

    let otpToUse = null;
    let reused = false;

    if (otpState?.otp && otpState?.otp_expires_at && otpState?.otp_used === false) {
      const expiresAtMs = new Date(otpState.otp_expires_at).getTime();
      const nowMs = Date.now();
      const notExpired = nowMs <= expiresAtMs;

      let withinReuseWindow = false;
      if (otpState.otp_created_at) {
        const createdAtMs = new Date(otpState.otp_created_at).getTime();
        withinReuseWindow = nowMs - createdAtMs >= 0 && nowMs - createdAtMs < reuseSec * 1000;
      }

      if (notExpired && withinReuseWindow) {
        otpToUse = String(otpState.otp);
        reused = true;
      }
    }

    if (!otpToUse) {
      otpToUse = genOtp();
      await authModel.saveOtp(user_id, otpToUse);
    }

    try {
      await otpService.sendOtp({
        to: email,
        user_name: user.user_name,
        otp: otpToUse,
      });
    } catch (mailErr) {
      console.error('[OTP] Mail send failed:', {
        to: email,
        code: mailErr?.code,
        responseCode: mailErr?.responseCode,
        response: mailErr?.response,
        message: mailErr?.message,
      });

      return res.status(502).json({
        success: false,
        message: 'OTP generated but email delivery failed (SMTP). Please try again or contact admin.',
      });
    }

    return res.json({
      success: true,
      message: reused ? 'Reusing last OTP. Please check email.' : 'OTP sent to registered email',
    });
  } catch (err) {
    return next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { user_id, otp } = req.body || {};

    if (!user_id || !otp) {
      const err = new Error('Missing user_id or otp');
      err.status = 400;
      throw err;
    }

    const user = await authModel.findUserById(user_id);
    if (!user) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }

    const otpState = await authModel.getOtpState(user_id);
    if (!otpState?.otp || !otpState?.otp_expires_at) {
      const err = new Error('OTP not found. Please request again.');
      err.status = 401;
      throw err;
    }

    if (otpState.otp_used === true) {
      const err = new Error('OTP already used. Please request again.');
      err.status = 401;
      throw err;
    }

    const nowMs = Date.now();
    const expiresAtMs = new Date(otpState.otp_expires_at).getTime();

    if (nowMs > expiresAtMs) {
      await authModel.clearOtp(user_id);
      const err = new Error('OTP expired. Please request again.');
      err.status = 401;
      throw err;
    }

    const entered = String(otp).trim();
    const stored = String(otpState.otp).trim();

    if (entered !== stored) {
      await authModel.incrementOtpAttempts(user_id);

      const attempts = Number(otpState.otp_attempts || 0) + 1;
      const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);
      if (attempts >= maxAttempts) {
        await authModel.clearOtp(user_id);
        const err = new Error('Too many invalid attempts. Please request a new OTP.');
        err.status = 429;
        throw err;
      }

      const err = new Error('Invalid OTP');
      err.status = 401;
      throw err;
    }

    await authModel.clearOtp(user_id);
    const accessToken = await issueAccessToken(user);

    return res.json({
      success: true,
      accessToken,
      tokenType: 'Bearer',
      user: toUserPayload(user),
    });
  } catch (err) {
    next(err);
  }
}

async function resendOtp(req, res, next) {
  try {
    const { user_id } = req.body || {};
    if (!user_id) {
      const err = new Error('Missing user_id');
      err.status = 400;
      throw err;
    }

    if (activeResend.get(user_id)) {
      return res.status(429).json({ success: false, message: 'OTP resend already in progress. Please wait.' });
    }
    activeResend.set(user_id, true);

    const user = await authModel.findUserById(user_id);
    if (!user) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }

    const email = await authModel.getUserEmailById(user_id);
    if (!email) {
      const err = new Error('Email not available');
      err.status = 400;
      throw err;
    }

    const otpState = await authModel.getOtpState(user_id);
    let otpToUse = null;
    if (otpState?.otp && otpState?.otp_expires_at && otpState?.otp_used === false) {
      const nowMs = Date.now();
      const expiresAtMs = new Date(otpState.otp_expires_at).getTime();
      if (nowMs <= expiresAtMs) otpToUse = String(otpState.otp);
    }

    if (!otpToUse) {
      otpToUse = genOtp();
      await authModel.saveOtp(user_id, otpToUse);
    }

    const otpStateAfter = await authModel.getOtpState(user_id);
    const dbOtp = otpStateAfter?.otp ? String(otpStateAfter.otp) : null;
    if (dbOtp && dbOtp !== String(otpToUse)) {
      otpToUse = dbOtp;
    }

    await otpService.sendOtp({
      to: email,
      user_name: user.user_name,
      otp: otpToUse,
    });

    return res.json({ success: true, message: 'OTP resent' });
  } catch (err) {
    next(err);
  } finally {
    if (req?.body?.user_id) activeResend.delete(req.body.user_id);
  }
}

async function getCurrentUser(req, res, next) {
  try {
    const userId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const user = await authModel.findUserById(userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Session invalid' });
    }

    return res.json({ success: true, user: toUserPayload(user) });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const userId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    if (userId) {
      await authModel.clearSession(userId);
    }
    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  requestOtp,
  verifyOtp,
  resendOtp,
  getCurrentUser,
  logout,
};
