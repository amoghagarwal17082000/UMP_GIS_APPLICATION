const pool = require("../../config/postgres");

exports.isPasswordValid = async (user_id, password) => {
  const passwordCheckResult = await pool.query(
    `SELECT password FROM sde.user_master WHERE user_id = $1`,
    [user_id]
  );

  if (!passwordCheckResult.rows.length) {
    return { userFound: false, isValid: false };
  }

  const currentPassword = String(passwordCheckResult.rows[0].password || "");
  return {
    userFound: true,
    isValid: String(password || "") === currentPassword
  };
};

exports.updateUserProfile = async (
  user_id,
  user_name,
  email,
  contact_no,
  hrmsid,
  password,
  designation
) => {
  const passwordStatus = await exports.isPasswordValid(user_id, password);

  if (!passwordStatus.userFound) {
    return null;
  }

  if (!passwordStatus.isValid) {
    return { invalidPassword: true };
  }

  const query = `
    UPDATE sde.user_master
    SET
      user_name = $2,
      email = $3,
      contact_no = $4,
      hrmsid = $5,
      designation = $6
    WHERE user_id = $1
    RETURNING *;
  `;

  const values = [
    user_id,
    user_name,
    email,
    contact_no,
    hrmsid,
    designation
  ];

  const result = await pool.query(query, values);

  return result.rows[0];
};
