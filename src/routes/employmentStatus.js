const express = require("express");
const router = express.Router();
const EmploymentStatusController = require("../controllers/EmploymentStatusController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.get("/", authenticate, EmploymentStatusController.list);
router.post("/", authenticate, isAdmin, EmploymentStatusController.create);
router.patch("/:id", authenticate, isAdmin, EmploymentStatusController.update);
router.delete("/:id", authenticate, isAdmin, EmploymentStatusController.remove);

module.exports = router;
