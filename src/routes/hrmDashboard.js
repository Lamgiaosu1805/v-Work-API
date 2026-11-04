const express = require("express");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");
const { getHrmOverview } = require("../services/hrmOverview.service");

const router = express.Router();

// Số liệu tổng quan nhân sự cho dashboard HRM (cùng quyền với danh sách nhân viên).
router.get(
  "/overview",
  authenticate,
  requirePermission("employee.view", "Employee"),
  async (req, res) => {
    try {
      const data = await getHrmOverview();
      return res.status(200).json({ message: "OK", data });
    } catch (error) {
      console.error("Error in getHrmOverview:", error);
      return res.status(500).json({ message: "Internal server error", error: error.message });
    }
  }
);

module.exports = router;
