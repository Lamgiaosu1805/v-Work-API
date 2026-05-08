const cron = require("node-cron");
const pushNotification = require("../helpers/pushNotification");

const cleanupDeviceTokens = async () => {
  try {
    const result = await pushNotification.cleanupStaleTokens();
    console.log(`[Cron] Cleanup device tokens: ${result.modifiedCount || 0} token inactive`);
  } catch (error) {
    console.error("Lỗi cron cleanupDeviceTokens:", error);
  }
};

cron.schedule("30 3 * * *", cleanupDeviceTokens);

module.exports = cleanupDeviceTokens;
