const DeviceTokenModel = require("../models/DeviceTokenModel");
const getFirebaseAdmin = require("../config/firebase");

const DEFAULT_STALE_DAYS = 90;

const normalizeData = (data = {}) => {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  );
};

const isInvalidFirebaseTokenError = (errorCode) => {
  return (
    errorCode === "messaging/invalid-registration-token" ||
    errorCode === "messaging/registration-token-not-registered"
  );
};

const deactivateInvalidTokens = async (tokens, responses) => {
  const invalidTokens = [];

  responses.forEach((response, index) => {
    const errorCode = response.error?.code;

    if (!response.success && isInvalidFirebaseTokenError(errorCode)) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length) {
    await DeviceTokenModel.updateMany(
      { fcm_token: { $in: invalidTokens } },
      { is_active: false, last_used_at: new Date() }
    );
  }

  return invalidTokens;
};

const sendToAccount = async ({ account_id, title, body, data = {} }) => {
  const safeData = data && typeof data === "object" && !Array.isArray(data) ? data : {};

  const deviceTokens = await DeviceTokenModel.find({
    account_id,
    is_active: true,
    isDeleted: false,
  }).select("fcm_token");

  const tokens = [...new Set(deviceTokens.map((item) => item.fcm_token))];

  if (!tokens.length) {
    return {
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      tokens,
    };
  }

  const firebaseAdmin = getFirebaseAdmin();
  const message = {
    tokens,
    notification: {
      title,
      body,
    },
    data: normalizeData({
      ...safeData,
      type: safeData.type || "test",
      timestamp: new Date().toISOString(),
    }),
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
  const invalidTokens = await deactivateInvalidTokens(tokens, response.responses);

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
    tokens,
  };
};

const cleanupStaleTokens = async ({ staleDays = DEFAULT_STALE_DAYS } = {}) => {
  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - staleDays);

  return DeviceTokenModel.updateMany(
    {
      is_active: true,
      isDeleted: false,
      last_used_at: { $lt: staleBefore },
    },
    {
      is_active: false,
      last_used_at: new Date(),
    }
  );
};

module.exports = {
  sendToAccount,
  deactivateInvalidTokens,
  cleanupStaleTokens,
};
