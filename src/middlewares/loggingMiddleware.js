// src/middlewares/loggingMiddleware.js
const SENSITIVE_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization'];

// Decode JWT payload (không verify) chỉ để lấy username cho log
const getUserFromToken = (req) => {
    try {
        const auth = req.headers.authorization;
        if (!auth?.startsWith('Bearer ')) return null;
        const payload = auth.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return decoded.username ?? null;
    } catch {
        return null;
    }
};

const safeSanitize = (value, options = {}) => {
  const {
    maxDepth = 5,
    _depth = 0,
    _seen = new WeakSet(),
  } = options;

  if (value === null || typeof value !== 'object') return value;
  if (_depth >= maxDepth) return '[Max depth]';
  if (_seen.has(value)) return '[Circular]';
  _seen.add(value);

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { message: value.message, name: value.name };
  if (value instanceof RegExp) return value.toString();

  if (Array.isArray(value)) {
    return value.map((v) =>
      safeSanitize(v, { maxDepth, _depth: _depth + 1, _seen })
    );
  }

  const out = {};
  try {
    Object.keys(value).forEach((key) => {
      try {
        if (SENSITIVE_KEYS.includes(key)) {
          out[key] = '*** HIDDEN ***';
        } else {
          out[key] = safeSanitize(value[key], {
            maxDepth,
            _depth: _depth + 1,
            _seen,
          });
        }
      } catch (e) {
        out[key] = '[Sanitize error]';
      }
    });
  } catch (e) {
    return '[Unserializable object]';
  }

  return out;
};

const loggingMiddleware = (req, res, next) => {
  // Lấy requestId từ header client gửi lên
  const requestId = req.headers['x-request-id'];
  req.requestId = requestId;

  try {
    console.log(`\n🔵 Request [${requestId}]:`, {
      method: req.method,
      url: req.originalUrl,
      user: getUserFromToken(req),
      body: safeSanitize(req.body),
    });
  } catch (e) {
    console.log('🔵 Request: [Logging error]', e && e.message);
  }

  const start = Date.now();
  const originalJson = res.json;

  res.json = function (data) {
    try {
      const duration = Date.now() - start;

      console.log(`\n🟢 Response [${requestId}]:`, {
        url: req.originalUrl,
        statusCode: res.statusCode,
        user: req.account?.username ?? getUserFromToken(req),
        duration: `${duration} ms`,
        data: safeSanitize(data),
      });

      // Nếu data là object, thêm requestId vào response body
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        data.requestId = requestId;
      }
    } catch (e) {
      console.log('🟢 Response: [Logging error]', e && e.message);
    }

    return originalJson.call(this, data);
  };

  next();
};

module.exports = loggingMiddleware;
