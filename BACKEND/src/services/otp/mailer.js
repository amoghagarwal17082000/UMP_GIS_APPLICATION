const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const activeOtpSends = new Map(); // key=email -> { cancelled: boolean }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientSmtpError(err) {
  const code = Number(err?.responseCode || 0);

  // Typical transient SMTP codes: 421, 450, 451, 452
  if ([421, 450, 451, 452].includes(code)) return true;

  // Network/timeouts
  const ecode = String(err?.code || '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(ecode)) return true;

  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('temporar') || msg.includes('try again')) return true;

  return false;
}

function isRelayPolicyError(err) {
  const msg = String(err?.response || err?.message || '').toLowerCase();
  const code = Number(err?.responseCode || 0);
  return code === 554 || msg.includes('relay rejected') || msg.includes('policy');
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_SERVER_HOST,
  port: Number(process.env.SMTP_PORT || 25),
  secure: false,

  pool: true,
  maxConnections: 3,
  maxMessages: 50,

  connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT_MS || 10_000),
  greetingTimeout: Number(process.env.SMTP_GREET_TIMEOUT_MS || 10_000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20_000),

  tls: { rejectUnauthorized: false },

  auth:
    process.env.FROM_MAIL && process.env.MAIL_PASSWORD
      ? { user: process.env.FROM_MAIL, pass: process.env.MAIL_PASSWORD }
      : undefined,
});

async function sendOtpMail({ to, user_name, otp }) {
  const subject = 'OTP for UMP Login';
  const from = process.env.FROM_MAIL;
  if (!from) throw new Error('FROM_MAIL is missing in .env');

  // Cancel any previous in-flight send for same recipient
  if (activeOtpSends.has(to)) {
    activeOtpSends.get(to).cancelled = true;
  }
  const ctx = { cancelled: false };
  activeOtpSends.set(to, ctx);

  try {
    // ✅ IMPORTANT: use absolute path safely
    const logoCandidates = [
      process.env.OTP_LOGO_PATH,
      path.resolve(__dirname, '../../public/Images/IR_logo.png'),
      path.resolve(__dirname, '../../public/images/IR_logo.png'),
    ].filter(Boolean);
    const logoPath = logoCandidates.find((candidate) => fs.existsSync(candidate));
    const logoHtml = logoPath
      ? '<img src="cid:irlogo" alt="Indian Railways" style="height:75px; display:block;" />'
      : '<div style="font-size:16px;font-weight:700;color:#0b3d91;white-space:nowrap;">Indian Railways</div>';

    const html = `
<div style="background:#f4f6f9;padding:40px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:650px;margin:0 auto;background:#ffffff;border-radius:14px;padding:40px;box-shadow:0 6px 18px rgba(0,0,0,0.08);">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;padding-right:15px;">
                ${logoHtml}
              </td>
              <td style="vertical-align:middle;">
                <h1 style="margin:0;font-size:36px;letter-spacing:2px;color:#1a1a1a;font-weight:800;font-family:'Segoe UI', Arial, sans-serif;">UMP</h1>
              </td>
            </tr>
          </table>
          <div style="height:4px;width:220px;background:#0b86a7;margin:15px auto 0;border-radius:3px;"></div>
        </td>
      </tr>
    </table>

    <h2 style="margin-top:0;color:#222;font-weight:600;">Dear ${user_name || 'User'},</h2>

    <p style="font-size:15px;color:#444;">
      Your One-Time Password (OTP) for logging into the <strong>UMP Web Application</strong> is:
    </p>

    <div style="margin:30px 0;text-align:center;font-size:34px;font-weight:800;letter-spacing:6px;color:#0b86a7;background:#f1f7fa;padding:18px 0;border-radius:8px;border:1px solid #dbe9f0;">
      ${otp}
    </div>

    <p style="font-size:14px;color:#555;">
      This OTP is valid for <strong>${process.env.OTP_TTL_MINUTES || 10} minutes</strong>.
    </p>

    <p style="font-size:14px;color:#555;">
      Please do not share this OTP with anyone. If you did not request it, kindly ignore this email.
    </p>

    <p style="font-size:14px;color:#222;">
      Thanks,<br/><strong>Team UMP</strong>
    </p>
  </div>
</div>`;

    const mailOptions = {
      from: `"UMP" <${from}>`,
      to,
      subject,
      html,
      attachments: logoPath
        ? [
            {
              filename: 'IR_logo.png',
              path: logoPath,
              cid: 'irlogo',
              contentDisposition: 'inline',
            },
          ]
        : [],
    };

    // ✅ fast retries for transient errors only
    const delays = [0, 1500, 3000]; // total max ~4.5s extra

    let lastErr = null;

    for (let i = 0; i < delays.length; i++) {
      if (ctx.cancelled) return { cancelled: true };

      if (delays[i] > 0) await sleep(delays[i]);
      if (ctx.cancelled) return { cancelled: true };

      try {
        const info = await transporter.sendMail(mailOptions);
        return { cancelled: false, info };
      } catch (err) {
        lastErr = err;

        console.error('[OTP] sendMail failed:', {
          to,
          attempt: i + 1,
          code: err?.code,
          responseCode: err?.responseCode,
          response: err?.response,
          message: err?.message,
        });

        // If relay policy error -> no point retrying
        if (isRelayPolicyError(err)) break;

        // Retry only if transient
        if (!isTransientSmtpError(err)) break;
      }
    }

    throw lastErr || new Error('SMTP send failed');
  } finally {
    if (activeOtpSends.get(to) === ctx) {
      activeOtpSends.delete(to);
    }
  }
}

module.exports = { sendOtpMail };
