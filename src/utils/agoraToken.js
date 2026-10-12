const { RtcTokenBuilder, RtcRole } = require("agora-token");
const axios = require("axios");
const AGORA_APP_ID = process.env.AGORA_APP_ID?.trim() || "";

const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE?.trim() || "";

const AGORA_CHAT_ORG = process.env.AGORA_CHAT_ORG_NAME?.trim() || "";

const AGORA_CHAT_APP = process.env.AGORA_CHAT_APP_NAME?.trim() || "";

const AGORA_CHAT_BASE_URL = (process.env.AGORA_CHAT_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const AGORA_CHAT_CLIENT_ID = process.env.AGORA_CHAT_CLIENT_ID?.trim() || "";

const AGORA_CHAT_CLIENT_SECRET =
  process.env.AGORA_CHAT_CLIENT_SECRET?.trim() || "";

const AGORA_CHAT_USER_PASSWORD = process.env.AGORA_CHAT_USER_PASSWORD || "";
// ======================================================
// Validate Agora Chat Configuration
// ======================================================

const validateAgoraChatConfig = () => {
  const missing = [];

  if (!AGORA_CHAT_BASE_URL) {
    missing.push("AGORA_CHAT_BASEURL");
  }

  if (!AGORA_CHAT_ORG) {
    missing.push("AGORA_CHAT_ORGNAME");
  }

  if (!AGORA_CHAT_APP) {
    missing.push("AGORA_CHAT_APNAME");
  }

  if (!AGORA_CHAT_CLIENT_ID) {
    missing.push("AGORA_CHAT_CLIENT_ID");
  }

  if (!AGORA_CHAT_CLIENT_SECRET) {
    missing.push("AGORA_CHAT_CLIENT_SECRET");
  }

  if (missing.length) {
    console.error("Missing Agora Chat configuration:", missing);

    throw new Error(
      `Agora Chat configuration is incomplete: ${missing.join(", ")}`,
    );
  }
};

// ======================================================
// Build Agora Chat REST API URL
// ======================================================

const getAgoraChatUrl = (path) => {
  validateAgoraChatConfig();

  return (
    `${AGORA_CHAT_BASE_URL}/` +
    `${encodeURIComponent(AGORA_CHAT_ORG)}/` +
    `${encodeURIComponent(AGORA_CHAT_APP)}/` +
    path.replace(/^\/+/, "")
  );
};

// ======================================================
// Generate Agora RTC Token
// ======================================================

const generateRtcToken = ({ channelName, uid, role = "subscriber" }) => {
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    throw new Error(
      "Agora RTC configuration is incomplete: check AGORA_APP_ID and AGORA_APP_CERTIFICATE",
    );
  }

  if (!channelName) {
    throw new Error("Agora RTC channel name is required");
  }

  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error("Agora RTC UID must be a non-negative integer");
  }

  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);

  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const rtcRole = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

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
// Generate Agora Chat Application Token
// ======================================================

const getAgoraChatAppToken = async () => {
  validateAgoraChatConfig();

  const tokenUrl = getAgoraChatUrl("token");

  try {
    const { data } = await axios.post(
      tokenUrl,
      {
        grant_type: "client_credentials",
        client_id: AGORA_CHAT_CLIENT_ID,
        client_secret: AGORA_CHAT_CLIENT_SECRET,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      },
    );

    if (!data?.access_token) {
      console.error("Agora Chat token response did not contain access_token", {
        responseKeys: Object.keys(data || {}),
      });

      throw new Error("Agora Chat did not return an application access token");
    }

    return data.access_token;
  } catch (error) {
    // Never log the request body, client secret, or returned access token.
    const status = error.response?.status;
    const responseData = error.response?.data;

    console.error("Agora Chat application token request failed", {
      url: tokenUrl,
      status,
      error: responseData?.error,
      errorDescription:
        responseData?.error_description ||
        responseData?.error_description_message,
      responseMessage:
        typeof responseData?.message === "string"
          ? responseData.message
          : undefined,
      responseCode: responseData?.code,
      message: error.message,
    });

    // Preserve a useful diagnostic message for the resolver.
    const detail =
      responseData?.error_description ||
      responseData?.message ||
      responseData?.error ||
      error.message;

    throw new Error(
      `Agora Chat application authentication failed${
        status ? ` (HTTP ${status})` : ""
      }: ${detail}`,
    );
  }
};

// ======================================================
// Create Agora Chat User
// Ignore duplicate users
// ======================================================

const createAgoraChatUser = async (username) => {
  if (!username) {
    throw new Error("Agora Chat username is required");
  }

  if (!AGORA_CHAT_USER_PASSWORD) {
    throw new Error("AGORA_CHAT_USER_PASSWORD is missing");
  }

  const appToken = await getAgoraChatAppToken();

  try {
    const response = await axios.post(
      getAgoraChatUrl("users"),
      {
        username,
        password: AGORA_CHAT_USER_PASSWORD,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    return response.data;
  } catch (error) {
    // Existing Chat users do not need to be created again.
    if (error.response?.data?.error === "duplicate_unique_property_exists") {
      return {
        success: true,
        alreadyExists: true,
      };
    }

    console.error("Agora Chat user creation failed", {
      username,
      status: error.response?.status,
      error: error.response?.data?.error,
      description: error.response?.data?.error_description,
      message: error.message,
    });

    throw new Error(
      `Agora Chat user creation failed: ${
        error.response?.status || error.message
      }`,
    );
  }
};

// ======================================================
// Generate Agora Chat User Token
// ======================================================

const generateChatToken = async (username) => {
  if (!username) {
    throw new Error("Agora Chat username is required");
  }

  if (!AGORA_CHAT_USER_PASSWORD) {
    throw new Error("AGORA_CHAT_USER_PASSWORD is missing");
  }

  const appToken = await getAgoraChatAppToken();

  const tokenUrl = getAgoraChatUrl("token");

  try {
    const { data } = await axios.post(
      tokenUrl,
      {
        grant_type: "password",
        username,
        password: AGORA_CHAT_USER_PASSWORD,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    if (!data?.access_token) {
      throw new Error("Agora Chat did not return a user access token");
    }

    return data.access_token;
  } catch (error) {
    console.error("Agora Chat user token request failed", {
      username,
      status: error.response?.status,
      error: error.response?.data?.error,
      description: error.response?.data?.error_description,
      message: error.message,
    });

    throw new Error(
      `Agora Chat user authentication failed: ${
        error.response?.status || error.message
      }`,
    );
  }
};

// ======================================================
// Create Agora Chat Room
// ======================================================

const createAgoraChatRoom = async (roomName) => {
  if (!roomName || typeof roomName !== "string") {
    throw new Error("A valid room name is required");
  }

  const appToken = await getAgoraChatAppToken();

  try {
    const response = await axios.post(
      getAgoraChatUrl("chatrooms"),
      {
        name: roomName,
        description: `DhwaniAstro live: ${roomName}`,
        maxusers: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const roomId = response.data?.data?.id || response.data?.data?.chatroomid;

    if (!roomId) {
      console.error("Agora Chat room creation returned no room ID", {
        responseKeys: Object.keys(response.data || {}),
      });

      throw new Error("Agora Chat did not return a chat room ID");
    }

    return roomId;
  } catch (error) {
    console.error("Agora Chat room creation failed", {
      status: error.response?.status,
      error: error.response?.data?.error,
      description: error.response?.data?.error_description,
      message: error.message,
    });

    throw new Error(
      `Agora Chat room creation failed: ${
        error.response?.status || error.message
      }`,
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
    senderId,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await axios.post(
      getAgoraChatUrl("messages"),
      {
        target_type: "chatrooms",
        target: [String(chatRoomId)],
        from: senderUsername,
        msg: {
          type: "txt",
          msg: `${giftName} x${quantity}`,
        },
        ext: giftPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    return response.data;
  } catch (error) {
    console.error("Agora Chat gift notification failed", {
      chatRoomId,
      status: error.response?.status,
      error: error.response?.data?.error,
      description: error.response?.data?.error_description,
      message: error.message,
    });

    throw new Error(
      `Agora Chat gift notification failed: ${
        error.response?.status || error.message
      }`,
    );
  }
};

// ======================================================
// Exports
// ======================================================

module.exports = {
  generateRtcToken,
  createAgoraChatUser,
  generateChatToken,
  createAgoraChatRoom,
  sendAgoraChatRoomGiftNotification,
};
