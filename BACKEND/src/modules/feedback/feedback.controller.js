const feedbackModel = require('../../modules/feedback/feedback.model');
const { getSessionUserId } = require('../auth/auth.session');

exports.createFeedback = async (req, res) => {
  try {
    const sessionUserId = getSessionUserId(req);
    const user_id = sessionUserId || req.body?.user_id;
    const message = req.body?.message;

    if (!user_id || !message) {
      return res.status(400).json({
        status: false,
        message: 'user_id and message required',
      });
    }

    const result = await feedbackModel.createFeedback(user_id, message);

    return res.json({
      status: true,
      message: 'Feedback submitted successfully',
      data: result,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      status: false,
      message: 'Server error',
    });
  }
};

exports.getAllFeedback = async (req, res) => {
  try {
    const data = await feedbackModel.getAllFeedback();

    return res.json({
      status: true,
      total: data.total,
      feedbacks: data.rows,
    });
  } catch (error) {
    console.log(error);
  }
};
