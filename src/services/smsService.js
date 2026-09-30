const axios = require("axios");

const sendOTP = async ({ countryCode, mobile, otp }) => {
  try {
    const fullMobile = `${countryCode.replace("+", "")}${mobile}`;
    console.log("----mobile no----:",fullMobile);

    const response = await axios.get(
      "https://control.msg91.com/api/v5/otp",
      {
        params: {
          authkey: process.env.MSG91_AUTH_KEY,
          template_id: process.env.MSG91_TEMPLATE_ID,
          mobile: fullMobile,
          otp: otp, // Remove this if your template auto-generates OTP
        },
      }
    );

    if (
      response.data.type === "error" ||
      response.data.status === "error"
    ) {
      throw new Error(response.data.message || "Failed to send OTP");
    }
    console.log("------comming for otp-----------------",response.data);
    return response.data;
  } catch (error) {
    console.error("MSG91 Error:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || "Failed to send OTP"
    );
  }
};

module.exports = {
  sendOTP,
};
