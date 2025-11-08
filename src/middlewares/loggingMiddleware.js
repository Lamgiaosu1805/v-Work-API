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

    // Log request body
    console.log('\n🔵 Request:', {
        method: req.method,
        url: req.originalUrl,
        body: sanitize(req.body),
    });

    const start = Date.now();
    const originalJson = res.json;

    // Ghi đè res.json để log response
    res.json = function (data) {
        const duration = Date.now() - start;
        console.log('\n🟢 Response:', {
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: `${duration} ms`,
            data: sanitize(data),
        });

        return originalJson.call(this, data);
    };

    next();
};

module.exports = loggingMiddleware;
