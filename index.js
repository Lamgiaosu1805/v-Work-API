process.env.TZ = 'Asia/Ho_Chi_Minh';
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./src/config/connectDB');
const route = require('./src/routes');

const app = express();

const allowedOrigins = (process.env.CLIENT_URLS || 'http://localhost:5173').split(',');

// Middlewares
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

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

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
})();