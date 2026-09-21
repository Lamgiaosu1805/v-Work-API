const express = require("express");
const router = express.Router();
const AgentController = require("../controllers/AgentController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");
const { authenticate } = require("../middlewares/authMiddleware");
const { requirePermission } = require("../core/authorization/require-permission.middleware");

router.post("/upsert", verifyInternalRequest, AgentController.upsert);
router.get("/:agent_code/qr", verifyInternalRequest, AgentController.generateQR);
router.get(
  "/",
  authenticate,
  requirePermission("agent.view", "Agent"),
  AgentController.getAll
);

module.exports = router;
