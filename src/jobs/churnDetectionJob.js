const cron = require('node-cron');
const redis = require('../config/redis');
const { _computeChurnRisks } = require('../controllers/AiController');

// Chạy mỗi thứ Hai 7:00 sáng — làm mới danh sách khách hàng rủi ro
const scheduleChurnDetection = () => {
    cron.schedule('0 7 * * 1', async () => {
        console.log('[ChurnDetection] Bắt đầu tính toán...');
        try {
            const result = await _computeChurnRisks();
            await redis.set('ai:churn_risks', JSON.stringify(result), 'EX', 86400 * 7);
            console.log(`[ChurnDetection] Hoàn tất: ${result.total} khách hàng rủi ro`);
        } catch (err) {
            console.log('[ChurnDetection] Lỗi:', err.message);
        }
    }, { timezone: 'Asia/Ho_Chi_Minh' });
};

module.exports = scheduleChurnDetection;
