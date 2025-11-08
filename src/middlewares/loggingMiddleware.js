// middlewares/requestIdMiddleware.js
const loggingMiddleware = (req, res, next) => {
    try {
        // 🧠 Lấy requestId từ header client gửi lên
        const requestId = req.headers['x-request-id'];

        if (!requestId) {
            console.warn('⚠️  Missing X-Request-Id header from client');
        }

        // Gắn vào req để các controller khác cũng dùng được
        req.requestId = requestId;

        // Khi gửi response, thêm lại requestId trong header để client trace
        res.setHeader('X-Request-Id', requestId || 'N/A');

        // Log request body ngắn gọn
        console.log(`\n🔵 [${requestId}] Request:`, {
            method: req.method,
            url: req.originalUrl,
            body: sanitize(req.body),
        });

        const start = Date.now();
        const originalJson = res.json;

        // Ghi đè res.json để log response có requestId
        res.json = function (data) {
            const duration = Date.now() - start;
            console.log(`\n🟢 [${requestId}] Response:`, {
                statusCode: res.statusCode,
                duration: `${duration} ms`,
                data: sanitize(data),
            });

            return originalJson.call(this, data);
        };
    } catch (err) {
        console.error('Error in requestId middleware:', err);
    }

    next();
};

// Ẩn thông tin nhạy cảm
function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clone = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
        if (['password', 'accessToken', 'refreshToken', 'authorization'].includes(key)) {
            clone[key] = '*** HIDDEN ***';
        } else {
            clone[key] = sanitize(obj[key]);
        }
    }
    return clone;
}

module.exports = loggingMiddleware;
