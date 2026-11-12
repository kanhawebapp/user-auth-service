const generateRtcToken = ({
  channelName,
  uid,
  role = "subscriber",
  expirationSeconds = 60 * 60,
}) => {
  validateRtcConfig();

  if (
    !channelName ||
    typeof channelName !== "string" ||
    !channelName.trim()
  ) {
    throw new Error("Agora RTC channel name is required");
  }

  if (
    !Number.isInteger(uid) ||
    uid <= 0 ||
    uid > 2147483647
  ) {
    throw new Error("Agora RTC UID must be a valid positive integer");
  }

  if (!["publisher", "subscriber"].includes(role)) {
    throw new Error(
      'Invalid Agora RTC role. Use "publisher" or "subscriber".'
    );
  }

  if (
    !Number.isInteger(expirationSeconds) ||
    expirationSeconds <= 0
  ) {
    throw new Error("Invalid RTC token expiration");
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  const privilegeExpiredTs =
    currentTimestamp + expirationSeconds;

  const rtcRole =
    role === "publisher"
      ? RtcRole.PUBLISHER
      : RtcRole.SUBSCRIBER;

  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName.trim(),
    uid,
    rtcRole,
    privilegeExpiredTs
  );
};