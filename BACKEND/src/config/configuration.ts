// @ts-nocheck

const readString = (value, fallback = '') => {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || fallback;
};

const toNumber = (value, fallback) => {
  const parsed = Number(readString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const configuration = () =>
  Object.freeze({
    NODE_ENV: readString(process.env.NODE_ENV, 'development'),
    PORT: toNumber(process.env.PORT, 4000),
    FROM_MAIL: readString(process.env.FROM_MAIL),
    MAIL_SERVICE: readString(process.env.MAIL_SERVICE),
    MAIL_PASSWORD: readString(process.env.MAIL_PASSWORD),
    SMTP_SERVER_HOST: readString(process.env.SMTP_SERVER_HOST),
    SMTP_PORT: toNumber(process.env.SMTP_PORT, 25),
    OTP_REUSE_SECONDS: toNumber(process.env.OTP_REUSE_SECONDS, 60),
    OTP_TTL_MINUTES: toNumber(process.env.OTP_TTL_MINUTES, 10),
    POSTGRES: Object.freeze({
      DB_NAME: readString(process.env.PGDATABASE),
      IR_ASSET_DB_NAME: readString(process.env.IR_ASSET_DB_DATABASE, 'ir_asset_db'),
      DB_HOST: readString(process.env.PGHOST),
      DB_PORT: toNumber(process.env.PGPORT, 5432),
      USERNAME: readString(process.env.PGUSER),
      PASSWORD: readString(process.env.PGPASSWORD),
    }),
    JWT: Object.freeze({
      KEY: readString(process.env.JWT_SECRET) || readString(process.env.JWT_SECRET_KEY),
      EXPIRES_IN: readString(process.env.JWT_EXPIRES_IN, '3h'),
      IDLE_TIMEOUT_MINUTES: toNumber(process.env.IDLE_TIMEOUT_MINUTES, 180),
    }),
    SESSION: Object.freeze({
      SECRET: readString(process.env.SESSION_SECRET),
      TTL_MS: toNumber(process.env.SESSION_TTL_MS, 28800000),
    }),
  });

module.exports = {
  configuration,
};
