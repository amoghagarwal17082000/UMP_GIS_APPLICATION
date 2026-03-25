const pool = require('../../config/postgres');

async function createRating(data, userId) {
  const sql = `
    INSERT INTO sde.user_ratings (
      objectid,
      user_id,
      user_name,
      railway,
      division,
      rating,
      comment,
      created_at
    )
    VALUES (
      (
        CASE
          WHEN pg_get_serial_sequence('sde.user_ratings', 'objectid') IS NOT NULL
            THEN nextval(pg_get_serial_sequence('sde.user_ratings', 'objectid'))
          ELSE (SELECT COALESCE(MAX(objectid), 0) + 1 FROM sde.user_ratings)
        END
      ),
      $1, $2, $3, $4, $5, $6,
      ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::timestamp(0))
    )
    RETURNING *;
  `;

  const values = [
    userId,
    data.user_name ?? null,
    data.railway ?? null,
    data.division ?? null,
    data.rating ?? null,
    data.comment ?? null,
  ];
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function getLastRating(userId) {
  const sql = `
    SELECT *
    FROM sde.user_ratings
    WHERE user_id::text = $1
    ORDER BY objectid DESC
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [userId]);
  return rows[0] || null;
}

module.exports = {
  createRating,
  getLastRating,
};

