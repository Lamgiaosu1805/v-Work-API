module.exports = {
  MONTHLY_ACCRUAL: 1,
  AUTO_REJECT_AFTER_DAYS: 3,
  // SRS: chỉ được tạo đơn nghỉ có ngày bắt đầu từ N ngày trước đến tương lai.
  RETROACTIVE_LIMIT_DAYS: 3,
  // SRS (update 3/8/2026): chỉ được ứng trước tối đa 1 ngày phép của tháng liền kề sau — không còn
  // cộng dồn không giới hạn theo số tháng (monthDiff * MONTHLY_ACCRUAL cũ cho phép ứng trước cả năm).
  ADVANCE_BORROW_MAX_DAYS: 1
};
