const prisma = require("../config/prisma");
const redis = require("../config/redis");
const { generateOtp } = require("../utils/otp");
const { generateAccessToken, generateRefreshToken } = require("../config/jwt");
const jwt = require("jsonwebtoken");
const { connectMongo, getDb } = require("../config/mongo");
const { sendOTP } = require("./smsService");

const OTP_EXPIRE = 300; // 5 minutes
const OTP_LIMIT = 10; // 3 per 10 min
const LOGIN_LIMIT = 5; // 5 failed attempts

// ================= LOG TO MONGO =================
async function logEvent(type, mobile, details = {}) {
  try {
    const db = await connectMongo();
    const collection = db.collection("userAuthLogs");

    await collection.insertOne({
      type,
      mobile,
      details,
      timestamp: new Date(),
    });
  } catch (error) {}
}

// ================= SEND OTP =================
const sendOTPService = async (countryCode, mobile) => {
  try {
    if (!countryCode || !mobile) {
      throw new Error("Country code and mobile required");
    }

    // Basic validation
    if (!/^\+[1-9]\d{1,4}$/.test(countryCode)) {
      throw new Error("Invalid country code");
    }

    if (!/^\d{6,14}$/.test(mobile)) {
      throw new Error("Invalid mobile number");
    }

    // Unique phone key
    const phoneKey = `${countryCode}-${mobile}`;

    // Rate limiting
    const rateKey = `otp_rate:${phoneKey}`;
    const count = await redis.incr(rateKey);

    if (count === 1) {
      await redis.expire(rateKey, 600); // 10 min window
    }

    if (count > OTP_LIMIT) {
      throw new Error("Too many OTP requests. Try later.");
    }

    // Generate OTP
    const otp = generateOtp();

    // Store OTP
    await redis.set(`otp:${phoneKey}`, otp, "EX", OTP_EXPIRE);
    await sendOTP({
      countryCode,
      mobile,
      otp,
    });

    // Log event
    await logEvent("OTP_GENERATED", phoneKey, { otp });

    return {
      message: "OTP sent successfully",
      otp, //need to remove in production
    };
  } catch (error) {
    await logEvent("OTP_FAILED", `${countryCode}-${mobile}`, {
      error: error.message,
    });

    throw new Error(error.message || "Failed to send OTP");
  }
};

// ================= VERIFY OTP =================
const verifyOTPService = async (countryCode, mobile, otp, source) => {
  try {
    if (!countryCode || !mobile || !otp) {
      throw new Error("Country code, mobile and OTP required");
    }

    // Create unique identifier
    const phoneKey = `${countryCode}-${mobile}`;

    // Get stored OTP
    const storedOTP = await redis.get(`otp:${phoneKey}`);

    if (!storedOTP) {
      await logEvent("OTP_EXPIRED", phoneKey);
      throw new Error("OTP expired. Please request again.");
    }

    if (storedOTP !== otp) {
      const failKey = `login_fail:${phoneKey}`;
      const fails = await redis.incr(failKey);

      if (fails === 1) {
        await redis.expire(failKey, 900);
      }

      if (fails > LOGIN_LIMIT) {
        await logEvent("LOGIN_FAILED_LIMIT", phoneKey);
        throw new Error("Too many failed attempts. Try later.");
      }

      await logEvent("OTP_INVALID", phoneKey, {
        enteredOtp: otp,
      });

      throw new Error("Invalid OTP");
    }

    //  OTP VALID → CLEANUP
    await redis.del(`otp:${phoneKey}`);
    await redis.del(`login_fail:${phoneKey}`);

    let user = await prisma.user.findUnique({
      where: {
        countryCode_mobile: {
          countryCode,
          mobile,
        },
      },
    });

    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          countryCode,
          mobile,
          source,
        },
      });
      isNewUser = true;
    }

    if (user.isDeleted) {
      throw new Error("Your account has been deleted. Please contact our support team.");
    }

    const hasName = !!user.name;

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    await logEvent("LOGIN_SUCCESS", phoneKey, {
      userId: user.id,
      isNewUser,
    });

    return {
      accessToken,
      refreshToken,
      user,
      isNewUser,
      hasName,
    };
  } catch (error) {
    await logEvent("LOGIN_FAILED", `${countryCode}${mobile}`, {
      error: error.message,
    });

    throw new Error(error.message || "Failed to verify OTP");
  }
};

// ================= REFRESH TOKEN =================
const refreshTokenService = async (token) => {
  try {
    if (!token) throw new Error("Refresh token required");

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      throw new Error("Invalid refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.refreshToken !== token)
      throw new Error("Invalid refresh token");

    const newAccess = generateAccessToken(user);
    const newRefresh = generateRefreshToken(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefresh },
    });

    await logEvent("TOKEN_REFRESHED", user.mobile, { userId: user.id });

    return { accessToken: newAccess, refreshToken: newRefresh, user };
  } catch (error) {
    await logEvent("TOKEN_REFRESH_FAILED", null, { error: error.message });
    throw new Error(error.message || "Failed to refresh token");
  }
};

module.exports = {
  sendOTPService,
  verifyOTPService,
  refreshTokenService,
};
