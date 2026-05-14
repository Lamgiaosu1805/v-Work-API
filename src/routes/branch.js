const express = require("express");
const router = express.Router();
const BranchController = require("../controllers/BranchController");
const { authenticate, isAdmin } = require("../middlewares/authMiddleware");

router.get("/getAll", authenticate, BranchController.getAll);

router.post("/create", authenticate, isAdmin, BranchController.create);

router.put("/update/:id", authenticate, isAdmin, BranchController.update);

router.delete("/delete/:id", authenticate, isAdmin, BranchController.remove);

module.exports = router;
