import express from "express";
import { authenticate } from "../../../middlewares/authMiddleware";
import { requirePermission } from "../../../core/authorization/require-permission.middleware";
import { asyncHandler } from "../../../core/http/async-handler";
import { crmSaleAdminHttpController } from "./crm-sale-admin.http.controller";

const router = express.Router();

router.get(
  "/admin/employees",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.getCrmSaleEmployees)
);

router.get(
  "/admin/employees/candidates",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.getCrmSaleCandidateEmployees)
);

router.get(
  "/admin/employees/invite-candidates",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.getCrmSaleInviteCandidateEmployees)
);

router.post(
  "/admin/employees/:employeeId/invite",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.inviteCrmSaleEmployee)
);

router.patch(
  "/admin/employees/:employeeId/role",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.changeCrmSaleRole)
);

router.delete(
  "/admin/employees/:employeeId",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.removeCrmSaleEmployee)
);

router.post(
  "/admin/employees/:employeeId/transfer",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.transferCrmSaleEmployee)
);

router.post(
  "/admin/employees/:employeeId/sip-password",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.configureCrmSaleSipPassword)
);

router.post(
  "/admin/employees/:employeeId/sync-sip",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.syncCrmSaleSipCredentials)
);

router.get(
  "/admin/employees/:employeeId/sip-profile",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.getCrmSaleSipProfileStatus)
);

router.post(
  "/admin/employees/:employeeId/sip-profile/refresh",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.refreshCrmSaleSipProfile)
);

router.patch(
  "/admin/employees/:employeeId/outbound-hotline",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.assignExtensionOutboundHotline)
);

router.patch(
  "/admin/employees/:employeeId/email",
  authenticate,
  requirePermission("hotline.manage", "HotlineAdmin"),
  asyncHandler(crmSaleAdminHttpController.setCrmSaleEmployeeEmail)
);

export = router;
