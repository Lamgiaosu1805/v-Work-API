const cron = require("node-cron");
const {
  recoverStaleHandbookAnswers,
  purgeExpiredHandbookConversations
} = require("../modules/handbook-assistant");

// Mỗi phút: chốt các câu trả lời Trợ lý Nội quy bị bỏ rơi (tiến trình chết giữa chừng) + hoàn lượt hỏi.
const recoverStaleAnswers = async () => {
  try {
    await recoverStaleHandbookAnswers();
  } catch (error) {
    console.error("Lỗi cron recoverStaleHandbookAnswers:", error);
  }
};

// 02:00 hằng ngày: xoá hẳn hội thoại quá hạn lưu (HANDBOOK_RETENTION_DAYS, mặc định 180 ngày).
const purgeExpiredConversations = async () => {
  try {
    await purgeExpiredHandbookConversations();
  } catch (error) {
    console.error("Lỗi cron purgeExpiredHandbookConversations:", error);
  }
};

function registerHandbookAssistantJobs() {
  cron.schedule("* * * * *", recoverStaleAnswers);
  cron.schedule("0 2 * * *", purgeExpiredConversations);
}

module.exports = {
  recoverStaleAnswers,
  purgeExpiredConversations,
  registerHandbookAssistantJobs
};
