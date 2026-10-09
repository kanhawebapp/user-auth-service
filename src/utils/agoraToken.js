
const {
  RtcTokenBuilder,
  RtcRole,
} = require("agora-token");

const axios = require("axios");

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

const AGORA_CHAT_ORG = process.env.AGORA_CHAT_ORG;
const AGORA_CHAT_APP = process.env.AGORA_CHAT_APP;

const AGORA_CHAT_CLIENT_ID =
  process.env.AGORA_CHAT_CLIENT_ID || "";

const AGORA_CHAT_CLIENT_SECRET =
  process.env.AGORA_CHAT_CLIENT_SECRET || "";

/**
 * RTC TOKEN
 */
const generateRtcToken = ({
  channelName,
  uid,
  role = "subscriber",
}) => {
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);

  const privilegeExpiredTs =
    currentTimestamp + expirationTimeInSeconds;

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
    privilegeExpiredTs
  );
};

/**
 * Get Agora Chat App Token
 */
const getAgoraChatAppToken = async () => {
  const { data } = await axios.post(
    `https://a61.chat.agora.io/${AGORA_CHAT_ORG}/${AGORA_CHAT_APP}/token`,
    {
      grant_type: "client_credentials",
      client_id: AGORA_CHAT_CLIENT_ID,
      client_secret: AGORA_CHAT_CLIENT_SECRET,
    }
  );

  if (!data.access_token) {
    throw new Error(
      "Agora Chat did not return an app access token"
    );
  }

  return data.access_token;
};

/**
 * Create Chat User (ignore if already exists)
 */
const createAgoraChatUser = async (username) => {
  const appToken = await getAgoraChatAppToken();

  try {
    await axios.post(
      `https://a61.chat.agora.io/${AGORA_CHAT_ORG}/${AGORA_CHAT_APP}/users`,
      {
        username,
        password: "123456",
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    // Ignore duplicate users
    if (
      err.response?.data?.error ===
      "duplicate_unique_property_exists"
    ) {
      return;
    }

    throw err;
  }
};

/**
 * Generate User Chat Token
 */
const generateChatToken = async (username) => {
  const appToken = await getAgoraChatAppToken();

  const { data } = await axios.post(
    `https://a61.chat.agora.io/${AGORA_CHAT_ORG}/${AGORA_CHAT_APP}/token`,
    {
      grant_type: "password",
      username,
      password: "123456",
    },
    {
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!data.access_token) {
    throw new Error(
      "Agora Chat did not return a user access token"
    );
  }

  return data.access_token;
};

/**
 * Create Agora Chat Room
 */
const createAgoraChatRoom = async (roomName) => {
  if (!roomName || typeof roomName !== "string") {
    throw new Error("A valid room name is required");
  }

  const appToken = await getAgoraChatAppToken();

  const response = await axios.post(
    `https://a61.chat.agora.io/${AGORA_CHAT_ORG}/${AGORA_CHAT_APP}/chatrooms`,
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
    }
  );

  const roomId =
    response.data?.data?.id ||
    response.data?.data?.chatroomid;

  if (!roomId) {
    throw new Error(
      "Agora Chat did not return a chat room ID"
    );
  }

  return roomId;
};

/**
 * Send Gift Notification to Agora Chat Room
 *
 * Call this after the gift wallet transaction succeeds.
 */
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

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    throw new Error("Gift quantity must be a positive integer");
  }

  if (
    !Number.isFinite(totalCoins) ||
    totalCoins < 0
  ) {
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

  const response = await axios.post(
    `https://a61.chat.agora.io/${AGORA_CHAT_ORG}/${AGORA_CHAT_APP}/messages`,
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
    }
  );

  return response.data;
};

module.exports = {
  generateRtcToken,
  createAgoraChatUser,
  generateChatToken,
  createAgoraChatRoom,
  sendAgoraChatRoomGiftNotification,
};

