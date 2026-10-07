// Public API module customer-care (Quy định 183A — phân bổ khách & SLA chăm sóc cho Sale).
// Xem docs/CRM-CUSTOMER-CARE-SLA-PLAN.md.
export {
  syncCustomerCare,
  assignCustomerToSale,
  endActiveAssignment,
  returnCustomerToPool,
  excludeCustomerFromPool,
  recordCallActivity,
  recordCareReport,
  listDueSlaActions,
  markAssignmentWarned
} from "./application/customer-care-commands.service";
export type {
  SyncCustomerCareInput,
  SyncCustomerCareResult,
  AssignCustomerToSaleInput,
  AssignCustomerToSaleResult,
  EndAssignmentInput,
  EndAssignmentResult,
  RecordActivityResult,
  DueSlaAction
} from "./application/customer-care-commands.service";
export {
  planPoolAllocation,
  buildSaleCapacityViews,
  setSaleAllocationStatus,
  setSaleCaps,
  isSaleLocked,
  requireCarePolicy
} from "./application/allocation.service";
export type {
  PoolAllocationPlan,
  PlannedAllocation,
  SaleCapacityView
} from "./application/allocation.service";
export { getCarePolicyView, updateCarePolicy } from "./application/care-policy.service";
export type { CarePolicyView, CarePolicyPatch } from "./application/care-policy.service";
export {
  listMyCareQueue,
  listAssignments,
  listCustomerAssignmentHistory,
  listPool,
  getCareDashboard,
  getActiveAssignmentForCustomer,
  isCompanyWideScope
} from "./application/customer-care-queries.service";
export type {
  ListAssignmentsFilters,
  ListPoolFilters
} from "./application/customer-care-queries.service";
export type { AssignmentEndReason, AssignmentChannel } from "./domain/customer-assignment.entity";
export type { CarePolicy } from "./domain/care-policy";
