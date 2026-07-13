const express = require("express");

const router = express.Router();
const HolidayController = require("../controllers/HolidayController");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");

router.get("/", authenticate, HolidayController.getHolidays);
router.post(
  "/",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_EVENTS),
  HolidayController.createHoliday
);
router.patch(
  "/:id",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_EVENTS),
  HolidayController.updateHoliday
);
router.delete(
  "/:id",
  authenticate,
  requirePermission(PERMISSION.HRM_MENU_EVENTS),
  HolidayController.deleteHoliday
);

module.exports = router;
