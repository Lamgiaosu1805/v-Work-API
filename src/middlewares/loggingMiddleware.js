// src/middlewares/loggingMiddleware.js
const SENSITIVE_KEYS = ['password', 'accessToken', 'refreshToken', 'authorization'];

const safeSanitize = (value, options = {}) => {
  const {
    maxDepth = 5,
    _depth = 0,
    _seen = new WeakSet(),
  } = options;

  // Primitive or null
  if (value === null || typeof value !== 'object') return value;

  // Avoid too deep recursion
  if (_depth >= maxDepth) return '[Max depth]';

  // Detect circular references
  if (_seen.has(value)) return '[Circular]';
  _seen.add(value);

  // Buffer
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  // Date
  if (value instanceof Date) return value.toISOString();

  // Error
  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }

  // RegExp
  if (value instanceof RegExp) return value.toString();

  // Array
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      try {
        out[i] = safeSanitize(value[i], {
          maxDepth,
          _depth: _depth + 1,
          _seen,
        });
      } catch (e) {
        out[i] = '[Sanitize error]';
      }
    }
    return out;
  }

  // Plain object (only own enumerable keys)
  const out = {};
  try {
    const keys = Object.keys(value);
    for (const key of keys) {
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
    }
  } catch (e) {
    return '[Unserializable object]';
  }

  return out;
};

const loggingMiddleware = (req, res, next) => {
  try {
    // Log only request body
    console.log('\n🔵 Request:', {
      method: req.method,
      url: req.originalUrl,
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
      console.log('\n🟢 Response:', {
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration: `${duration} ms`,
        data: safeSanitize(data),
      });
    } catch (e) {
      console.log('🟢 Response: [Logging error]', e && e.message);
    }

    return originalJson.call(this, data);
  };

  next();
};

module.exports = loggingMiddleware;
