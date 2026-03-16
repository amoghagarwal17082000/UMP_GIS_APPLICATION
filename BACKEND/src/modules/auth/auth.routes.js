const express = require('express');
const router = express.Router();

const authController = require('./auth.controller');
const captchaService = require('../../services/captcha/captchaService');

router.post('/login', authController.login);
router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);
router.get('/me', authController.getCurrentUser);
router.post('/logout', authController.logout);

router.get('/captcha/new', (req, res) => {
  try {
    const captcha = captchaService.generateCaptcha();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    return res.json({
      success: true,
      captchaId: captcha?.captchaId,
      image: captcha?.image || '',
      expiresAt: captcha?.expiresAt,
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Captcha generation failed' });
  }
});

router.get('/captcha/validate', (req, res) => {
  const captchaId = req.query.captchaId;
  const captchaValue = req.query.captchaValue;

  if (!captchaId || !captchaValue) {
    return res.status(400).json({ success: false, message: 'Missing captchaId or captchaValue' });
  }

  const result = captchaService.validateCaptcha(String(captchaId), String(captchaValue));
  const ok = typeof result === 'boolean' ? result : !!result?.ok;

  return res.json({
    success: ok,
    message: ok ? 'Captcha ok' : result?.reason || 'Invalid captcha',
  });
});

router.post('/captcha/new', (req, res) => {
  try {
    const clientType = req.headers['x-client-type'];
    const captcha = captchaService.generateCaptcha();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (clientType && String(clientType).toLowerCase() === 'mobile') {
      return res.json({ data: captcha });
    }

    return res.json({
      success: true,
      captchaId: captcha?.captchaId,
      image: captcha?.image || captcha?.dataUrl || '',
      expiresAt: captcha?.expiresAt,
    });
  } catch (e) {
    console.error('[CAPTCHA] generate failed:', e);
    return res.status(500).json({
      success: false,
      message: 'Captcha generation failed',
      error: String(e?.message || e),
    });
  }
});

router.post('/captcha/validate', (req, res) => {
  const { captchaId, captchaValue } = req.body || {};

  if (!captchaId || !captchaValue) {
    return res.status(400).json({
      success: false,
      message: 'Missing captchaId or captchaValue',
    });
  }

  const result = captchaService.validateCaptcha(captchaId, captchaValue);
  const ok = typeof result === 'boolean' ? result : !!result?.ok;

  return res.json({
    success: ok,
    message: ok ? 'Captcha ok' : result?.reason || 'Invalid captcha',
  });
});

module.exports = router;
