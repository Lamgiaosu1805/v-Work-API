const express = require("express");
const router = express.Router();
const HolidayController = require("../controllers/HolidayController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.get("/", authenticate, HolidayController.getHolidays);
router.post("/", authenticate, isAdmin, HolidayController.createHoliday);
router.patch("/:id", authenticate, isAdmin, HolidayController.updateHoliday);
router.delete("/:id", authenticate, isAdmin, HolidayController.deleteHoliday);

module.exports = router;
