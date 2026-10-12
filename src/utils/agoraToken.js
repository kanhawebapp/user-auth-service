const axios = require("axios");
const agoraToken = require("agora-token");

const { RtcTokenBuilder, RtcRole, ChatTokenBuilder } = agoraToken;

// ======================================================
// Agora RTC Configuration
// ======================================================

const AGORA_APP_ID = process.env.AGORA_APP_ID?.trim() || "";

const AGORA_APP_CERTIFICATE =
  process.env.AGORA_APP_CERTIFICATE?.trim() || "";

// ======================================================
// Agora Chat Configuration
// Use the SAME Chat credentials as the working astrologer side.
// ======================================================

const CHAT_APPKEY = process.env.AGORA_CHAT_APP_KEY?.trim() || "";

const AGORA_CHAT_ORG =
  process.env.AGORA_CHAT_ORG_NAME?.trim() || "";

const AGORA_CHAT_APP =
  process.env.AGORA_CHAT_APP_NAME?.trim() || "";

const AGORA_CHAT_BASE_URL = (
  process.env.AGORA_CHAT_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const CHAT_APP_ID =
  process.env.AGORA_CHAT_APP_ID?.trim() || "";

const CHAT_APP_CERTIFICATE =
  process.env.AGORA_CHAT_APP_CERTIFICATE?.trim() || "";

const AGORA_CHAT_USER_PASSWORD =
  process.env.AGORA_CHAT_USER_PASSWORD || "";

// ======================================================
// Token Expiration
// ======================================================

const TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60;

// ======================================================
// Validate Agora RTC Configuration
// ======================================================

const validateRtcConfig = () => {
  const missing = [];

  if (!AGORA_APP_ID) {
    missing.push("AGORA_APP_ID");
  }

  if (!AGORA_APP_CERTIFICATE) {
    missing.push("AGORA_APP_CERTIFICATE");
  }

  if (missing.length > 0) {
    throw new Error(
      `Agora RTC configuration is incomplete: ${missing.join(", ")}`,
    );
  }
};

// ======================================================
// Validate Agora Chat Configuration
// ======================================================

const validateAgoraChatConfig = () => {
  const requiredVariables = {
    AGORA_CHAT_APP_KEY: CHAT_APPKEY,
    AGORA_CHAT_ORG_NAME: AGORA_CHAT_ORG,
    AGORA_CHAT_APP_NAME: AGORA_CHAT_APP,
    AGORA_CHAT_BASE_URL: AGORA_CHAT_BASE_URL,
    AGORA_CHAT_APP_ID: CHAT_APP_ID,
    AGORA_CHAT_APP_CERTIFICATE: CHAT_APP_CERTIFICATE,
  };

  const missing = Object.entries(requiredVariables)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Agora Chat environment variables: ${missing.join(", ")}`,
    );
  }

  if (
    !ChatTokenBuilder ||
    typeof ChatTokenBuilder.buildAppToken !== "function" ||
    typeof ChatTokenBuilder.buildUserToken !== "function"
  ) {
    throw new Error(
      "ChatTokenBuilder is not available in the installed agora-token package",
    );
  }

  if (!AGORA_CHAT_BASE_URL.startsWith("https://")) {
    throw new Error("AGORA_CHAT_BASE_URL must use HTTPS");
  }
};

// ======================================================
// Build Agora Chat REST API URL
// ======================================================

const getAgoraChatUrl = (path) => {
  validateAgoraChatConfig();

  const normalizedPath = String(path || "").replace(/^\/+/, "");

  return (
    `${AGORA_CHAT_BASE_URL}/` +
    `${encodeURIComponent(AGORA_CHAT_ORG)}/` +
    `${encodeURIComponent(AGORA_CHAT_APP)}/` +
    normalizedPath
  );
};

// ======================================================
// Extract Agora API Error
// ======================================================

const getAgoraErrorMessage = (error, fallbackMessage) => {
  const responseData = error?.response?.data;

  return (
    responseData?.error_description ||
    responseData?.error ||
    responseData?.message ||
    error?.message ||
    fallbackMessage
  );
};

// ======================================================
// Generate Agora RTC Token
// ======================================================

const generateRtcToken = ({
  channelName,
  uid,
  role = "subscriber",
}) => {
  validateRtcConfig();

  if (!channelName || typeof channelName !== "string") {
    throw new Error("Agora RTC channel name is required");
  }

  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error("Agora RTC UID must be a non-negative integer");
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  const privilegeExpiredTs =
    currentTimestamp + 60 * 60;

  const rtcRole =
    role === "publisher"
      ? RtcRole.PUBLISHER
      : RtcRole.SUBSCRIBER;

  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    rtcRole,
    privilegeExpiredTs,
  );
};

// ======================================================
// Generate Agora Chat Application Token LOCALLY
//
// No client_credentials REST request is required.
// Uses the same method as the working astrologer side.
// ======================================================

const getAgoraChatAppToken = async () => {
  validateAgoraChatConfig();

  try {
    const appToken = ChatTokenBuilder.buildAppToken(
      CHAT_APP_ID,
      CHAT_APP_CERTIFICATE,
      TOKEN_EXPIRATION_SECONDS,
    );

    if (!appToken || typeof appToken !== "string") {
      throw new Error(
        "Agora Chat application token generation returned an invalid token",
      );
    }

    return appToken;
  } catch (error) {
    console.error("Agora Chat application token generation failed:", {
      message: error.message,
    });

    throw new Error(
      `Failed to generate Agora Chat application token: ${error.message}`,
    );
  }
};

// ======================================================
// Create or Verify Agora Chat User
// ======================================================

const createAgoraChatUser = async (username) => {
  validateAgoraChatConfig();

  if (!username || !String(username).trim()) {
    throw new Error("Agora Chat username is required");
  }

  const chatUsername = String(username).trim();

  if (
    chatUsername.length > 64 ||
    !/^[a-z0-9_.-]+$/.test(chatUsername)
  ) {
    throw new Error(
      "Invalid Agora Chat username. Use lowercase letters, numbers, underscores, hyphens, or periods.",
    );
  }

  if (!AGORA_CHAT_USER_PASSWORD) {
    throw new Error("AGORA_CHAT_USER_PASSWORD is missing");
  }

  // Generate the management token locally.
  const appToken = await getAgoraChatAppToken();

  const userUrl = getAgoraChatUrl("users");

  try {
    const response = await axios.post(
      userUrl,
      {
        username: chatUsername,
        password: AGORA_CHAT_USER_PASSWORD,
        nickname: chatUsername,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    return {
      success: true,
      alreadyExists: false,
      username: chatUsername,
      data: response.data,
    };
  } catch (error) {
    const status = error.response?.status;
    const responseData = error.response?.data;

    const errorMessage = String(
      getAgoraErrorMessage(
        error,
        "Failed to create Agora Chat user",
      ),
    );

    const duplicateUser =
      /duplicate_unique_property_exists|already exists|already exist|duplicate username/i.test(
        `${responseData?.error || ""} ${responseData?.message || ""} ${errorMessage}`,
      );

    if (
      duplicateUser &&
      (status === 400 || status === 409)
    ) {
      return {
        success: true,
        alreadyExists: true,
        username: chatUsername,
      };
    }

    console.error("Agora Chat user creation failed:", {
      status,
      error: responseData?.error,
      message: errorMessage,
    });

    throw new Error(
      `Agora Chat user creation failed: ${errorMessage}`,
    );
  }
};

// ======================================================
// Generate Agora Chat User Token LOCALLY
//
// Does not use password-grant or client_credentials.
// Uses the same token builder as the astrologer side.
// ======================================================

const generateChatToken = async (username) => {
  validateAgoraChatConfig();

  if (!username || !String(username).trim()) {
    throw new Error("Agora Chat username is required");
  }

  const chatUsername = String(username).trim();

  if (
    chatUsername.length > 64 ||
    !/^[a-z0-9_.-]+$/.test(chatUsername)
  ) {
    throw new Error("Invalid Agora Chat username");
  }

  try {
    const chatToken = ChatTokenBuilder.buildUserToken(
      CHAT_APP_ID,
      CHAT_APP_CERTIFICATE,
      chatUsername,
      TOKEN_EXPIRATION_SECONDS,
    );

    if (!chatToken || typeof chatToken !== "string") {
      throw new Error(
        "Agora Chat user token generation returned an invalid token",
      );
    }

    return chatToken;
  } catch (error) {
    console.error("Agora Chat user token generation failed:", {
      username: chatUsername,
      message: error.message,
    });

    throw new Error(
      `Failed to generate Agora Chat user token: ${error.message}`,
    );
  }
};

// ======================================================
// Create Agora Chat Room
// ======================================================

const createAgoraChatRoom = async (roomName) => {
  validateAgoraChatConfig();

  if (!roomName || typeof roomName !== "string" || !roomName.trim()) {
    throw new Error("A valid Agora Chat room name is required");
  }

  const appToken = await getAgoraChatAppToken();

  try {
    const response = await axios.post(
      getAgoraChatUrl("chatrooms"),
      {
        name: roomName.trim(),
        description: `DhwaniAstro live: ${roomName.trim()}`,
        maxusers: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const responseData = response.data;

    const room =
      responseData?.data?.[0] ??
      responseData?.data ??
      responseData;

    const roomId =
      room?.id ??
      room?.chatroomid ??
      room?.chatroom_id;

    if (!roomId) {
      throw new Error(
        "Agora Chat did not return a room ID",
      );
    }

    return roomId;
  } catch (error) {
    const responseData = error.response?.data;

    console.error("Agora Chat room creation failed:", {
      status: error.response?.status,
      error: responseData?.error,
      message: getAgoraErrorMessage(
        error,
        "Failed to create Agora Chat room",
      ),
    });

    throw new Error(
      `Agora Chat room creation failed: ${getAgoraErrorMessage(
        error,
        "Unknown error",
      )}`,
    );
  }
};

// ======================================================
// Send Gift Notification to Agora Chat Room
// Call after the gift wallet transaction succeeds.
// ======================================================

const sendAgoraChatRoomGiftNotification = async ({
  chatRoomId,
  senderUsername,
  senderId,
  giftName,
  icon = null,
  quantity,
  totalCoins,
}) => {
  validateAgoraChatConfig();

  if (!chatRoomId) {
    throw new Error("Agora Chat room ID is required");
  }

  if (!senderUsername) {
    throw new Error("Agora Chat sender username is required");
  }

  if (!giftName) {
    throw new Error("Gift name is required");
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Gift quantity must be a positive integer");
  }

  if (!Number.isFinite(totalCoins) || totalCoins < 0) {
    throw new Error("A valid total coin amount is required");
  }

  const appToken = await getAgoraChatAppToken();

  const giftPayload = {
    type: "gift",
    giftName,
    icon,
    quantity,
    totalCoins,
    senderId: senderId || null,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await axios.post(
      getAgoraChatUrl("messages"),
      {
        target_type: "chatrooms",
        target: [String(chatRoomId)],
        from: String(senderUsername),
        msg: {
          type: "txt",
          msg: `${giftName} x${quantity}`,
        },
        ext: giftPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    return response.data;
  } catch (error) {
    const responseData = error.response?.data;

    console.error("Agora Chat gift notification failed:", {
      chatRoomId,
      status: error.response?.status,
      error: responseData?.error,
      message: getAgoraErrorMessage(
        error,
        "Failed to send gift notification",
      ),
    });

    throw new Error(
      `Agora Chat gift notification failed: ${getAgoraErrorMessage(
        error,
        "Unknown error",
      )}`,
    );
  }
};

// ======================================================
// Get Agora Chat App Key
// ======================================================

const getAgoraChatAppKey = () => {
  validateAgoraChatConfig();
  return CHAT_APPKEY;
};

// ======================================================
// Exports
// ======================================================

module.exports = {
  generateRtcToken,
  getAgoraChatAppToken,
  createAgoraChatUser,
  generateChatToken,
  createAgoraChatRoom,
  sendAgoraChatRoomGiftNotification,
  getAgoraChatAppKey,
};