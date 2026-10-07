import mongoose from "mongoose";
import { authenticate } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { createRouter } from "../../../middlewares/validateObjectId";
import { customerCareHttpController as c } from "./customer-care.http.controller";

const router = createRouter();
router.param("saleId", (req, res, next, value) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return res.status(400).json({ errorCode: "INVALID_ID", message: "saleId không hợp lệ" });
  }
  return next();
});

const canView = requirePermission("customer_care.view", "Customer");
const canManage = requirePermission("customer_care.manage", "Customer");
const canConfigure = requirePermission("customer_care.policy", "Customer");

// Sale
router.get("/my-queue", authenticate, canView, asyncHandler(c.getMyQueue));
router.get("/customers/:id/history", authenticate, canView, asyncHandler(c.getCustomerHistory));

// Quản lý điều phối
router.get("/assignments", authenticate, canManage, asyncHandler(c.getAssignments));
router.get("/pool", authenticate, canManage, asyncHandler(c.getPool));
router.get("/dashboard", authenticate, canManage, asyncHandler(c.getDashboard));
router.get("/sales", authenticate, canManage, asyncHandler(c.getSales));
router.patch(
  "/sales/:saleId/allocation",
  authenticate,
  canManage,
  asyncHandler(c.updateSaleAllocation)
);
router.post("/customers/:id/assign", authenticate, canManage, asyncHandler(c.assignCustomer));
router.post("/customers/:id/revoke", authenticate, canManage, asyncHandler(c.revokeCustomer));
router.post("/customers/:id/return-to-pool", authenticate, canManage, asyncHandler(c.returnToPool));
router.post("/customers/:id/exclude", authenticate, canManage, asyncHandler(c.excludeFromPool));

// Cấu hình (CRM/IT)
router.get("/policy", authenticate, canManage, asyncHandler(c.getPolicy));
router.put("/policy/:appCode", authenticate, canConfigure, asyncHandler(c.updatePolicy));

export = router;
