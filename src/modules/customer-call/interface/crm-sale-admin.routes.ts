import express from "express";
import { authenticate, isAdmin } from "../../../middlewares/authMiddleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { crmSaleAdminHttpController } from "./crm-sale-admin.http.controller";

const router = express.Router();

router.get(
  "/admin/employees",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.getCrmSaleEmployees)
);

router.post(
  "/admin/employees/:employeeId/invite",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.inviteCrmSaleEmployee)
);

router.patch(
  "/admin/employees/:employeeId/role",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.changeCrmSaleRole)
);

router.delete(
  "/admin/employees/:employeeId",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.removeCrmSaleEmployee)
);

router.post(
  "/admin/employees/:employeeId/transfer",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.transferCrmSaleEmployee)
);

router.post(
  "/admin/employees/:employeeId/sip-password",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.configureCrmSaleSipPassword)
);

router.post(
  "/admin/employees/:employeeId/sync-sip",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.syncCrmSaleSipCredentials)
);

router.patch(
  "/admin/employees/:employeeId/outbound-hotline",
  authenticate,
  isAdmin,
  asyncHandler(crmSaleAdminHttpController.assignExtensionOutboundHotline)
);

export = router;
