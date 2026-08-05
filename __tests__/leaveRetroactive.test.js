const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { onApprove } = require("../src/helpers/leaveHandler");
const { getLeaveBalance } = require("../src/modules/leave");
const UserInfoModel = require("../src/models/UserInfoModel");
const WorkSheetModel = require("../src/models/WorkSheetModel");
const WorkDayStatusModel = require("../src/models/WorkDayStatusModel");
const ShiftModel = require("../src/models/ShiftModel");
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");
const { LEAVE_BALANCE_REASON } = require("../src/constants");
const redisMock = require("./mocks/redis");

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-06-24"; // thứ 4

const at = (hhmm) => moment.tz(`${DATE_KEY} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();
const dayStart = () => moment.tz(DATE_KEY, TZ).startOf("day").toDate();

let mongod;
let userInfo;
let shift;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  shift = await ShiftModel.create({
    name: "Ca hành chính",
    start_time: "08:00",
    end_time: "17:30"
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await UserInfoModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  redisMock.__store.clear();
  userInfo = await UserInfoModel.create({
    full_name: "Nhân viên Test",
    cccd: "012345678901",
    phone_number: "0900000001",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: "NVTEST01",
    employment_type: "fulltime"
  });
  // Seed số dư ban đầu = 5 qua ledger (thay vì field leave_balance.annual cũ)
  await LeaveBalanceModel.create({
    user_id: userInfo._id,
    amount: 5,
    reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL
  });
});

// Đơn nghỉ 1 ngày (cả sáng lẫn chiều) cho DATE_KEY
const makeLeaveRequest = () => ({
  _id: new mongoose.Types.ObjectId(),
  user_id: userInfo._id,
  from_date: dayStart(),
  from_period: "morning",
  to_date: dayStart(),
  to_period: "afternoon",
  total_days: 1,
  leave_type: "paid",
  paid_days: 1,
  unpaid_days: 0
});

describe("onApprove — đơn nghỉ phép hồi tố đè lên ngày đã đi làm", () => {
  test("ngày đã chấm công đủ in+out: status lật về present và hoàn phép", async () => {
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: dayStart(),
      shifts: [shift._id],
      check_in: at("08:00"),
      check_out: at("17:30")
    });

    await onApprove(makeLeaveRequest(), null);

    const status = await WorkDayStatusModel.findOne({ user_id: userInfo._id });
    expect(status.status).toBe("present");

    expect(await getLeaveBalance(userInfo._id)).toBe(6); // 5 + 1 hoàn phép
  });

  test("ngày chưa có chấm công: giữ nguyên leave_paid, không hoàn phép", async () => {
    await onApprove(makeLeaveRequest(), null);

    const status = await WorkDayStatusModel.findOne({ user_id: userInfo._id });
    expect(status.status).toBe("leave_paid");

    expect(await getLeaveBalance(userInfo._id)).toBe(5);
  });

  test("chỉ check-in buổi sáng rồi về (thiếu check-out): không lật status", async () => {
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: dayStart(),
      shifts: [shift._id],
      check_in: at("08:00"),
      check_out: null
    });

    await onApprove(makeLeaveRequest(), null);

    const status = await WorkDayStatusModel.findOne({ user_id: userInfo._id });
    expect(status.status).toBe("leave_paid");

    expect(await getLeaveBalance(userInfo._id)).toBe(5);
  });
});
