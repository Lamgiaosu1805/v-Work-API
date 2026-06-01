require('dotenv').config();
const db = require('../src/config/connectDB');
const redis = require('../src/config/redis');
const { _computeChurnRisks } = require('../src/controllers/AiController');

(async () => {
    try {
        await db.connect();
        console.log('Đang tính toán danh sách khách hàng rủi ro...');

        const result = await _computeChurnRisks(null); // null = tất cả (admin view)
        await redis.set('ai:churn_risks:all', JSON.stringify(result), 'EX', 86400 * 7);

        console.log(`\nHoàn tất: ${result.total} khách hàng có nguy cơ rời bỏ\n`);
        result.customers.forEach((c, i) => {
            const days = c.neverInvested ? 'Chưa từng đầu tư' : `${c.daysSinceLastInvestment} ngày`;
            console.log(`${i + 1}. ${c.name} | ${c.phone_number} | ${days}`);
        });
    } catch (err) {
        console.error('Lỗi:', err.message);
    } finally {
        await redis.quit();
        process.exit(0);
    }
})();
