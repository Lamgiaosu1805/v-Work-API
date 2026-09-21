const express = require("express");

const router = express.Router();
const HolidayController = require("../controllers/HolidayController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

router.get(
  "/",
  authenticate,
  requirePermission("holiday.view", "Holiday"),
  HolidayController.getHolidays
);
router.post(
  "/",
  authenticate,
  requirePermission("holiday.manage", "Holiday"),
  HolidayController.createHoliday
);
router.patch(
  "/:id",
  authenticate,
  requirePermission("holiday.manage", "Holiday"),
  HolidayController.updateHoliday
);
router.delete(
  "/:id",
  authenticate,
  requirePermission("holiday.delete", "Holiday"),
  HolidayController.deleteHoliday
);

module.exports = router;
