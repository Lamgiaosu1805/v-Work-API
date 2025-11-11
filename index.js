require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const db = require('./src/config/connectDB');
const route = require('./src/routes');

const app = express();

// Middlewares
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request & Response logging middleware
app.use(require('./src/middlewares/loggingMiddleware'));

// Routing
route(app);

// Connect to MongoDB và start server
(async () => {
  try {
    await db.connect();

    // Import cron job sau khi DB connect
    require('./src/jobs/genWorkSheet');

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Dừng app nếu DB không connect được
  }
})();
