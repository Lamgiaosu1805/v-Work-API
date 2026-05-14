const express = require("express");
const router = express.Router();
const AgentController = require("../controllers/AgentController");
const verifyInternalRequest = require("../middlewares/verifyInternalRequest");
const { authenticate, canManage } = require("../middlewares/authMiddleware");

router.post("/upsert", verifyInternalRequest, AgentController.upsert);
router.get("/:agent_code/qr", verifyInternalRequest, AgentController.generateQR);
router.get("/", authenticate, canManage("crm"), AgentController.getAll);

module.exports = router;
