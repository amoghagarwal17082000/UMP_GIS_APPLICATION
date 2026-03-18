const ratingModel = require('./rating.model');
const authModel = require('../auth/auth.model');

async function createRating(req, res, next) {
  try {
    const normalizedUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();
    const rating = req.body?.rating;
    const comment = req.body?.comment;

    if (!normalizedUserId) {
      const err = new Error('user_id is required');
      err.status = 400;
      throw err;
    }

    if (rating == null || rating === '') {
      const err = new Error('rating is required');
      err.status = 400;
      throw err;
    }

    const user = await authModel.findUserById(normalizedUserId);
    if (!user) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }

    const result = await ratingModel.createRating(
      {
        user_name: user.user_name,
        railway: user.zone,
        division: user.division_code,
        rating,
        comment: comment ?? '',
      },
      normalizedUserId
    );

    res.status(201).json({
      message: 'Rating added successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function getLastRating(req, res, next) {
  try {
    const normalizedUserId = String(req?.user?.sub || req?.user?.user_id || '').trim();

    if (!normalizedUserId) {
      const err = new Error('user_id is required');
      err.status = 400;
      throw err;
    }

    const result = await ratingModel.getLastRating(normalizedUserId);

    res.json({
      message: 'Last rating fetched',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRating,
  getLastRating,
};
