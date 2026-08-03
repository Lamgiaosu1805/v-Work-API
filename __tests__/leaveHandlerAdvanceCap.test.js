const moment = require("moment-timezone");

jest.mock("../src/modules/leave", () => ({
  getLeaveBalance: jest.fn()
}));

const { getLeaveBalance } = require("../src/modules/leave");
const leaveHandler = require("../src/helpers/leaveHandler");

const TZ = "Asia/Ho_Chi_Minh";

// monthOffset=0 dùng "ngày mai" (weekday gần nhất) để chắc chắn còn nằm trong tương lai của THÁNG
// HIỆN TẠI — chỉ trật (monthDiff thành 1) đúng ngày cuối cùng của tháng, cùng dạng rủi ro chấp nhận
// được như helper weekdayFromNow đã dùng ở __tests__/workflows/create-request.workflow.test.js.
// monthOffset>=1 luôn an toàn vì nằm trọn trong tháng tương lai, không đụng biên "hôm nay".
function weekdayInMonth(monthOffset) {
  let m =
    monthOffset === 0
      ? moment.tz(TZ).add(1, "day")
      : moment.tz(TZ).add(monthOffset, "months").startOf("month").date(1);
  while (m.day() === 0 || m.day() === 6) {
    m = m.add(1, "day");
  }
  return m.format("YYYY-MM-DD");
}

const userInfo = { _id: "u1" };

afterEach(() => {
  getLeaveBalance.mockReset();
});

// SRS (update 3/8/2026): chỉ được ứng trước tối đa 1 ngày phép của tháng liền kề sau — trước đây
// leaveHandler cộng dồn không giới hạn `monthDiff * MONTHLY_ACCRUAL` (monthDiff có thể là 2, 3, ...
// tháng), cho phép ứng trước cả năm nếu chọn ngày đủ xa trong tương lai.
describe("leaveHandler.validate() — cap ứng trước phép (SRS 3/8/2026)", () => {
  test("tháng hiện tại (monthDiff=0), balance=0 -> vẫn bị từ chối như cũ (không ứng trước)", async () => {
    getLeaveBalance.mockResolvedValue(0);
    const day = weekdayInMonth(0);

    const result = await leaveHandler.validate(
      {
        from_date: day,
        from_period: "morning",
        to_date: day,
        to_period: "afternoon",
        leave_type: "paid"
      },
      userInfo
    );

    expect(result.error).toMatchObject({ status: 400 });
  });

  test("tháng liền kề sau (monthDiff=1), balance=0 -> được ứng trước tối đa 1 ngày (không đổi hành vi cũ, MONTHLY_ACCRUAL=1)", async () => {
    getLeaveBalance.mockResolvedValue(0);
    const day = weekdayInMonth(1);

    const result = await leaveHandler.validate(
      {
        from_date: day,
        from_period: "morning",
        to_date: day,
        to_period: "afternoon",
        leave_type: "paid"
      },
      userInfo
    );

    expect(result.error).toBeUndefined();
    expect(result.payload.paid_days).toBe(1);
  });

  test("2 tháng sau (monthDiff=2), balance=0 -> KHÔNG còn được ứng trước (trước đây được vì monthDiff*MONTHLY_ACCRUAL=2)", async () => {
    getLeaveBalance.mockResolvedValue(0);
    const day = weekdayInMonth(2);

    const result = await leaveHandler.validate(
      {
        from_date: day,
        from_period: "morning",
        to_date: day,
        to_period: "afternoon",
        leave_type: "paid"
      },
      userInfo
    );

    expect(result.error).toMatchObject({
      status: 400,
      message: "Bạn không còn ngày nghỉ phép có lương"
    });
  });

  test("tháng liền kề sau nhưng đã có sẵn balance đủ -> không bị chặn bởi cap (cap chỉ giới hạn phần ỨNG TRƯỚC)", async () => {
    getLeaveBalance.mockResolvedValue(5);
    const day = weekdayInMonth(1);

    const result = await leaveHandler.validate(
      {
        from_date: day,
        from_period: "morning",
        to_date: day,
        to_period: "afternoon",
        leave_type: "paid"
      },
      userInfo
    );

    expect(result.error).toBeUndefined();
    expect(result.payload.paid_days).toBe(1);
  });
});
