const feedbackModel = require('../../modules/feedback/feedback.model');

exports.createFeedback = async (req, res) => {
  try {
    const user_id = String(req?.user?.sub || req?.user?.user_id || '').trim();
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
