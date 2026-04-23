// routes/app.js
const express = require("express");
const router = express.Router();
const AppController = require("../controllers/AppController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.post("/create", authenticate, isAdmin, AppController.create);
// router.get("/", AppController.getAll);
// router.patch("/:id/toggle", AppController.toggle);

module.exports = router;