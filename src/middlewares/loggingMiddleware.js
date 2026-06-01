// src/middlewares/loggingMiddleware.js
const IS_PROD = process.env.NODE_ENV === 'production';
const SENSITIVE_KEYS = new Set(['password', 'accessToken', 'refreshToken', 'authorization']);
// Bỏ qua log cho các request tĩnh/health
const SKIP_PATHS = ['/favicon.ico', '/health'];

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
  const { maxDepth = 4, _depth = 0, _seen = new WeakSet() } = options;
  if (value === null || typeof value !== 'object') return value;
  if (_depth >= maxDepth) return '[Max depth]';
  if (_seen.has(value)) return '[Circular]';
  _seen.add(value);
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { message: value.message, name: value.name };
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) {
    // Trong production chỉ log tối đa 5 phần tử đầu mảng
    const arr = IS_PROD ? value.slice(0, 5) : value;
    const result = arr.map((v) => safeSanitize(v, { maxDepth, _depth: _depth + 1, _seen }));
    if (IS_PROD && value.length > 5) result.push(`... (${value.length - 5} more)`);
    return result;
  }
  const out = {};
  try {
    for (const key of Object.keys(value)) {
      try {
        out[key] = SENSITIVE_KEYS.has(key) ? '*** HIDDEN ***'
          : safeSanitize(value[key], { maxDepth, _depth: _depth + 1, _seen });
      } catch { out[key] = '[Sanitize error]'; }
    }
  } catch { return '[Unserializable object]'; }
  return out;
};

const loggingMiddleware = (req, res, next) => {
  if (SKIP_PATHS.includes(req.path)) return next();

  const requestId = req.headers['x-request-id'];
  req.requestId = requestId;
  const start = Date.now();

  // Dùng setImmediate để không block event loop trên hot path
  setImmediate(() => {
    try {
      // Trong production chỉ log tóm tắt request, bỏ body
      if (IS_PROD) {
        console.log(`🔵 [${requestId}] ${req.method} ${req.originalUrl} — user: ${getUserFromToken(req)}`);
      } else {
        console.log(`\n🔵 Request [${requestId}]:`, {
          method: req.method,
          url: req.originalUrl,
          user: getUserFromToken(req),
          body: safeSanitize(req.body),
        });
      }
    } catch { /* ignore logging errors */ }
  });

  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - start;

    setImmediate(() => {
      try {
        if (IS_PROD) {
          // Chỉ log đầy đủ khi có lỗi
          if (res.statusCode >= 400) {
            console.log(`🔴 [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms — user: ${req.account?.username ?? getUserFromToken(req)}`, safeSanitize(data));
          } else {
            console.log(`🟢 [${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms — user: ${req.account?.username ?? getUserFromToken(req)}`);
          }
        } else {
          console.log(`\n🟢 Response [${requestId}]:`, {
            url: req.originalUrl,
            statusCode: res.statusCode,
            user: req.account?.username ?? getUserFromToken(req),
            duration: `${duration} ms`,
            data: safeSanitize(data),
          });
        }
      } catch { /* ignore */ }
    });

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      data.requestId = requestId;
    }
    return originalJson.call(this, data);
  };

  next();
};

module.exports = loggingMiddleware;
