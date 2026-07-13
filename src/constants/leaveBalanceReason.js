const LEAVE_BALANCE_REASON = Object.freeze({
  MONTHLY_ACCRUAL: "monthly_accrual",
  LEAVE_REQUEST_DEDUCTION: "leave_request_deduction",
  REJECT_REFUND: "reject_refund",
  CANCEL_REFUND: "cancel_refund",
  ATTENDANCE_OVERRIDE_REFUND: "attendance_override_refund",
  AUTO_REJECT_REFUND: "auto_reject_refund",
  RETROACTIVE_PROMOTION_BACKPAY: "retroactive_promotion_backpay",
  HR_MANUAL_ADJUSTMENT: "hr_manual_adjustment"
});

const LEAVE_BALANCE_REASON_VALUES = Object.values(LEAVE_BALANCE_REASON);

module.exports = { LEAVE_BALANCE_REASON, LEAVE_BALANCE_REASON_VALUES };
