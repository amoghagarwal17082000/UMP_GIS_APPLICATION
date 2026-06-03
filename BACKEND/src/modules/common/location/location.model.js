const pool = require('../../../config/postgres');
const { irAssetDbPool } = require('../../../config/postgres');

async function getStates() {
  const sql = `
    SELECT
      objectid,
      UPPER(state) AS state,
      state_lgd
    FROM sde.state_bdy
    WHERE NULLIF(TRIM(state), '') IS NOT NULL
    ORDER BY state
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

async function getDistricts(filters = {}) {
  const params = [];
  const where = [`NULLIF(TRIM(district), '') IS NOT NULL`];

  const state = String(filters.state || '').trim();
  if (state) {
    params.push(state);
    where.push(`UPPER(state) = UPPER($${params.length})`);
  }

  const stateLgd = Number(filters.state_lgd);
  if (Number.isFinite(stateLgd)) {
    params.push(stateLgd);
    where.push(`state_lgd = $${params.length}`);
  }

  const sql = `
    SELECT
      objectid,
      UPPER(district) AS district,
      COALESCE(NULLIF(district_lgd, '')::text, lgd_distri::text) AS district_lgd,
      UPPER(state) AS state,
      state_lgd
    FROM sde.district_bdy
    WHERE ${where.join(' AND ')}
    ORDER BY state, district
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getParliamentaryConstituencies(filters = {}) {
  const params = [];
  const where = [`NULLIF(TRIM(COALESCE(pc_name, pc, parliament, constituen)), '') IS NOT NULL`];

  const state = String(filters.state || '').trim();
  if (state) {
    params.push(state);
    where.push(`UPPER(name_of_st) = UPPER($${params.length})`);
  }

  const q = String(filters.q || filters.search || '').trim();
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      pc_name ILIKE $${params.length}
      OR pc ILIKE $${params.length}
      OR parliament ILIKE $${params.length}
      OR constituen ILIKE $${params.length}
      OR irpsm_pc_n ILIKE $${params.length}
      OR mp_name ILIKE $${params.length}
    )`);
  }

  const sql = `
    SELECT
      objectid,
      gid,
      id,
      UPPER(COALESCE(NULLIF(constituen, ''), NULLIF(pc_name, ''), NULLIF(pc, ''), NULLIF(parliament, ''))) AS constituency_name,
      UPPER(pc) AS pc,
      UPPER(pc_name) AS pc_name,
      UPPER(name_of_st) AS state,
      UPPER(parliament) AS parliament,
      UPPER(constituen) AS constituen,
      constitu_1,
      irpsm_pc_n,
      mp_name,
      irpsm_cons
    FROM sde.parliamentary_constituency
    WHERE ${where.join(' AND ')}
    ORDER BY state, constituency_name
  `;

  const { rows } = await irAssetDbPool.query(sql, params);
  return rows;
}

async function getRailways() {
  const sql = `
    SELECT DISTINCT
      NULLIF(TRIM(rly_name), '') AS rly_name,
      NULLIF(TRIM(rlycode), '') AS rlycode
    FROM div_master
    WHERE NULLIF(TRIM(rly_name), '') IS NOT NULL
      AND NULLIF(TRIM(rlycode), '') IS NOT NULL
    ORDER BY rly_name, rlycode
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

module.exports = {
  getStates,
  getDistricts,
  getParliamentaryConstituencies,
  getRailways,
};
