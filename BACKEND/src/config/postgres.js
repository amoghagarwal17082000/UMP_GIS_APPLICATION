const { Pool } = require('pg');
const { configuration } = require('./configuration.ts');

const config = configuration();

function createPool(database) {
  return new Pool({
    host: config.POSTGRES.DB_HOST,
    database,
    user: config.POSTGRES.USERNAME,
    password: config.POSTGRES.PASSWORD,
    port: config.POSTGRES.DB_PORT,
    max: 20,
    idleTimeoutMillis: 30000,
  });
}

const pool = createPool(config.POSTGRES.DB_NAME);
const irAssetDbPool = createPool(config.POSTGRES.IR_ASSET_DB_NAME);

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

irAssetDbPool.on('error', (err) => {
  console.error('Unexpected IR asset DB pool error', err);
});

module.exports = pool;
module.exports.irAssetDbPool = irAssetDbPool;
