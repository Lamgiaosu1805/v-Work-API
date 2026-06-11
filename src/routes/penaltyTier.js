const express = require("express");
const router = express.Router();
const PenaltyTierController = require("../controllers/PenaltyTierController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.get("/", authenticate, isAdmin, PenaltyTierController.getTiers);
router.post("/", authenticate, isAdmin, PenaltyTierController.createGeneration);
router.patch("/:id", authenticate, isAdmin, PenaltyTierController.updateTier);
router.delete("/:id", authenticate, isAdmin, PenaltyTierController.deleteTier);

module.exports = router;
