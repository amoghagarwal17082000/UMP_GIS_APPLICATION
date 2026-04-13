const profileModel = require("./profile.model");

exports.validatePassword = async (req, res) => {
  try {
    const { user_id, password } = req.body;
    const passwordStatus = await profileModel.isPasswordValid(user_id, password);

    if (!passwordStatus.userFound) {
      return res.status(404).json({
        status: false,
        message: "User not found"
      });
    }

    if (!passwordStatus.isValid) {
      return res.status(401).json({
        status: false,
        message: "Wrong password"
      });
    }

    return res.status(200).json({
      status: true,
      message: "Password validated"
    });
  } catch (error) {
    console.error("Profile Password Validation Error:", error);
    return res.status(500).json({
      status: false,
      message: error.message
    });
  }
};

exports.updateProfile = async (req, res) => {

  try {

    console.log("profile controller comes");

    const {
      user_id,
      user_name,
      email,
      contact_no,
      hrmsid,
      password,
      designation
    } = req.body;

    const profile = await profileModel.updateUserProfile(
      user_id,
      user_name,
      email,
      contact_no,
      hrmsid,
      password,
      designation
    );

    if (!profile) {
      return res.status(404).json({
        status: false,
        message: "User not found"
      });
    }

    if (profile.invalidPassword) {
      return res.status(401).json({
        status: false,
        message: "Wrong password"
      });
    }

    res.status(200).json({
      status: true,
      message: "Profile updated successfully",
      data: profile
    });

  } catch (error) {

    console.error("Profile Error:", error);

    res.status(500).json({
      status: false,
      message: error.message
    });

  }
};
