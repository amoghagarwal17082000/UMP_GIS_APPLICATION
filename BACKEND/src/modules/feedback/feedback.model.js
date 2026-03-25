const pool = require("../../config/postgres");

exports.createFeedback = async (user_id, message) => {
  const userQuery = `
    SELECT user_name, email, contact_no, user_type
    FROM sde.user_master
    WHERE user_id = $1
  `;

  const userResult = await pool.query(userQuery, [user_id]);

  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  //   const query = `
  //     INSERT INTO sde.feedback_table
  //     (user_name, user_id, user_type, email, mobile, message)
  //     VALUES ($1,$2,$3,$4,$5,$6)
  //     RETURNING *
  //   `;

  const query = `INSERT INTO sde.feedback_table
(objectid, user_name, user_id, user_type, email, mobile, message)
VALUES (nextval('sde.feedback_table_objectid_seq'), $1,$2,$3,$4,$5,$6)
RETURNING *;
`;

  const result = await pool.query(query, [
    user.name,
    user_id,
    user.user_type,
    user.email,
    user.mobile,
    message,
  ]);

  return result.rows[0];
};

exports.getAllFeedback = async () => {
  const query = `
    SELECT *
    FROM sde.feedback_table
    WHERE is_deleted = 0
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query);

  return {
    rows: result.rows,
    total: result.rowCount,
  };
};


