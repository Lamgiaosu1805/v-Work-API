process.env.TZ = 'Asia/Ho_Chi_Minh';
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./src/config/connectDB');
const route = require('./src/routes');

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = process.env.BASE_URL
  ? [process.env.BASE_URL]
  : ['*'];

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  socket.on('join_feed', () => socket.join('feed'));
  socket.on('leave_feed', () => socket.leave('feed'));
  socket.on('join_post', (postId) => socket.join(`post:${postId}`));
  socket.on('leave_post', (postId) => socket.leave(`post:${postId}`));
});

app.set('io', io);

// Nén response — tiết kiệm băng thông đáng kể với JSON payload lớn
app.use(compression());

// Middlewares
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ limit: '500kb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting — bảo vệ khỏi brute-force và request storm
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 phút
  max: 300,                  // 300 req/phút/IP — đủ cho 100 người dùng bình thường
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều yêu cầu, vui lòng thử lại sau' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 phút
  max: 20,                   // 20 lần đăng nhập/15 phút/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau 15 phút' },
});
app.use(globalLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/refreshToken', authLimiter);

// Request timeout — ngắt kết nối treo sau 30s để giải phóng slot
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) res.status(503).json({ message: 'Request timeout' });
  });
  next();
});

// Request & Response logging middleware
app.use(require('./src/middlewares/loggingMiddleware'));

// Route refer — phải đặt TRƯỚC route(app)
app.get('/refer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'refer.html'));
});

// Routing
route(app);

// Connect to MongoDB và start server
(async () => {
  try {
    await db.connect();

    require('./src/jobs/genWorkSheet');
    require('./src/jobs/cleanupDeviceTokens');
    require('./src/jobs/weeklyReportJob');
    require('./src/jobs/churnDetectionJob')();
    const { ensureAllDeptFolders } = require('./src/jobs/ensureDeptFolders');
    await ensureAllDeptFolders();

    const port = process.env.PORT || 3000;
    httpServer.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });

    // Graceful shutdown — cho phép request đang xử lý hoàn thành trước khi tắt
    const shutdown = (signal) => {
      console.log(`${signal} received — shutting down gracefully`);
      httpServer.close(async () => {
        try {
          await require('mongoose').disconnect();
          console.log('MongoDB disconnected');
        } catch { /* ignore */ }
        process.exit(0);
      });
      // Force exit sau 15s nếu vẫn còn request treo
      setTimeout(() => process.exit(1), 15000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
})();
