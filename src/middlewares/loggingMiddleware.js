const loggingMiddleware = (req, res, next) => {
    const sanitize = (obj) => {
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
    };

    // Log request
    console.log('\n🔵 Request:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        query: sanitize(req.query),
        body: sanitize(req.body),
        headers: sanitize(req.headers),
    });

    // Capture the original res.json to override it
    const originalJson = res.json;

    // Override res.json method
    res.json = function (data) {
        // Log response (ẩn thông tin nhạy cảm nếu có)
        console.log('\n🟢 Response:', {
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            data: sanitize(data),
        });

        return originalJson.call(this, data);
    };

    next();
};

module.exports = loggingMiddleware;
