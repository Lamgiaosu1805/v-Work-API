process.env.TZ = "Asia/Ho_Chi_Minh";
require("dotenv").config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const morgan = require("morgan");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const db = require("./src/config/connectDB");
const route = require("./src/routes");
const setupChatSocket = require("./src/sockets/chatSocket");
const { setIO } = require("./src/sockets/ioRegistry");
const { startCronJobs } = require("./src/jobs");
const { ensureAllDeptFolders } = require("./src/jobs/ensureDeptFolders");
const { serveEncryptedFile } = require("./src/middlewares/serveEncryptedFile");
const swaggerSpec = require("./src/config/swagger");

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = process.env.BASE_URL ? [process.env.BASE_URL] : ["*"];

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  transports: ["websocket", "polling"]
});

io.on("connection", (socket) => {
  socket.on("join_feed", () => socket.join("feed"));
  socket.on("leave_feed", () => socket.leave("feed"));
  socket.on("join_post", (postId) => socket.join(`post:${postId}`));
  socket.on("leave_post", (postId) => socket.leave(`post:${postId}`));
});

app.set("io", io);
setIO(io);
setupChatSocket(io);

app.set("trust proxy", 1);

app.use(compression());

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ limit: "500kb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PUBLIC_UPLOAD_DIR =
  process.env.NODE_ENV === "production"
    ? process.env.UPLOAD_DIR_PUBLIC_PROD
    : process.env.UPLOAD_DIR_PUBLIC_DEV;

app.get("/f/:token", serveEncryptedFile);

app.use("/static", express.static(PUBLIC_UPLOAD_DIR, { maxAge: "7d", index: false }));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Quá nhiều yêu cầu, vui lòng thử lại sau" }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Quá nhiều lần thử đăng nhập, vui lòng thử lại sau 15 phút" }
});
app.use(globalLimiter);
app.use("/auth/login", authLimiter);
app.use("/auth/refreshToken", authLimiter);

app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) res.status(503).json({ message: "Request timeout" });
  });
  next();
});

app.use(require("./src/middlewares/loggingMiddleware"));

app.get("/refer", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "refer.html"));
});

app.get("/api-docs.json", (req, res) => res.json(swaggerSpec));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

route(app);

(async () => {
  try {
    await db.connect();

    startCronJobs();
    await ensureAllDeptFolders();

    const port = process.env.PORT || 3000;
    httpServer.listen(port, () => {
      console.log(`App listening on port ${port}`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received — shutting down gracefully`);
      httpServer.close(async () => {
        try {
          await mongoose.disconnect();
          console.log("MongoDB disconnected");
        } catch {
          /* ignore */
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 15000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
})();
