const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { onApprove } = require("../src/helpers/forgotCheckinHandler");
const { ForgotCheckinRequest } = require("../src/models/RequestModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const WorkSheetModel = require("../src/models/WorkSheetModel");
const WorkDayStatusModel = require("../src/models/WorkDayStatusModel");
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");
const AttendancePenaltyModel = require("../src/models/AttendancePenaltyModel");
const redisMock = require("./mocks/redis");

const TZ = "Asia/Ho_Chi_Minh";
const MONTH_ANCHOR = "2026-06-01"; // cố định, không phụ thuộc ngày chạy test

function weekdaysInMonth(count) {
  const dates = [];
  let m = moment.tz(MONTH_ANCHOR, TZ).startOf("month");
  while (dates.length < count) {
    if (m.day() !== 0 && m.day() !== 6) dates.push(m.format("YYYY-MM-DD"));
    m.add(1, "day");
  }
  return dates;
}

function saturdaysInMonth(count) {
  const dates = [];
  let m = moment.tz(MONTH_ANCHOR, TZ).startOf("month");
  while (dates.length < count) {
    if (m.day() === 6) dates.push(m.format("YYYY-MM-DD"));
    m.add(1, "day");
  }
  return dates;
}

const at = (dateKey, hhmm) => moment.tz(`${dateKey} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();

let mongod;
let userInfo;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await AttendancePenaltyModel.create({
    type: "forgot",
    from_count: 4,
    to_count: null,
    penalty_kind: "work_unit",
    penalty_value: 1,
    effective_from: new Date("2020-01-01T00:00:00+07:00"),
    description: "test tier",
    is_active: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await ForgotCheckinRequest.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  redisMock.__store.clear();
  userInfo = await UserInfoModel.create({
    full_name: "Nhân viên Test",
    cccd: "012345678901",
    phone_number: "0900000001",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: "NVTEST",
    employment_type: "fulltime"
  });
});

async function approveRequest({ date, type, expected_check_in, expected_check_out }) {
  const request = await ForgotCheckinRequest.create({
    user_id: userInfo._id,
    date: moment.tz(date, TZ).startOf("day").toDate(),
    type,
    expected_check_in: expected_check_in ?? null,
    expected_check_out: expected_check_out ?? null,
    status: "approved"
  });
  await onApprove(request, null);
  return request;
}

// Regression: bug thực tế user báo - máy chấm công chỉ ghi nhận 1 lần quẹt (thực ra là
// giờ ra về) nhưng bị lưu nhầm vào check_in. Duyệt đơn "quên check-in" trước đây ghi đè
// thẳng check_in bằng giờ mới, làm mất luôn giờ ra về thật, đồng thời work_unit bị treo ở
// 0 vì onApprove không tự tính lại work_unit (chỉ Excel import mới tính).
test("duyệt đơn quên check-in: cứu giờ ra về thật + tính đúng work_unit thay vì treo 0", async () => {
  const [dateKey] = weekdaysInMonth(1);
  await WorkSheetModel.create({
    user_id: userInfo._id,
    date: moment.tz(dateKey, TZ).startOf("day").toDate(),
    shifts: [],
    check_in: at(dateKey, "18:00"), // thực ra là giờ ra về, bị đọc nhầm vào check_in
    work_unit: 0
  });

  await approveRequest({
    date: dateKey,
    type: "check_in",
    expected_check_in: at(dateKey, "08:00")
  });

  const ws = await WorkSheetModel.findOne({ user_id: userInfo._id });
  expect(ws.check_in).toEqual(at(dateKey, "08:00"));
  expect(ws.check_out).toEqual(at(dateKey, "18:00")); // được cứu lại, không mất
  expect(ws.work_unit).toBe(1); // lần 1 trong tháng, chưa vượt giới hạn -> đủ công
});

test("quên chấm công lần thứ 4 trong tháng (ngày thường): work_unit = 0.5 (nửa công)", async () => {
  const dates = weekdaysInMonth(4);
  let lastWorksheet;
  for (const dateKey of dates) {
    await approveRequest({
      date: dateKey,
      type: "both",
      expected_check_in: at(dateKey, "08:00"),
      expected_check_out: at(dateKey, "17:30")
    });
    lastWorksheet = await WorkSheetModel.findOne({
      user_id: userInfo._id,
      date: moment.tz(dateKey, TZ).startOf("day").toDate()
    });
  }
  expect(lastWorksheet.work_unit).toBe(0.5);

  const firstWorksheet = await WorkSheetModel.findOne({
    user_id: userInfo._id,
    date: moment.tz(dates[0], TZ).startOf("day").toDate()
  });
  expect(firstWorksheet.work_unit).toBe(1);
});

test("quên chấm công Thứ 7 trong giới hạn cho phép: work_unit = 0.5", async () => {
  const [saturday] = saturdaysInMonth(1);
  await approveRequest({
    date: saturday,
    type: "both",
    expected_check_in: at(saturday, "08:00"),
    expected_check_out: at(saturday, "12:00")
  });
  const ws = await WorkSheetModel.findOne({ user_id: userInfo._id });
  expect(ws.work_unit).toBe(0.5);
});

test("quên chấm công Thứ 7 nhưng đã vượt giới hạn (lần 4 trong tháng): work_unit = 0.25", async () => {
  const weekdays = weekdaysInMonth(3);
  const [saturday] = saturdaysInMonth(1);

  for (const dateKey of weekdays) {
    await approveRequest({
      date: dateKey,
      type: "both",
      expected_check_in: at(dateKey, "08:00"),
      expected_check_out: at(dateKey, "17:30")
    });
  }

  await approveRequest({
    date: saturday,
    type: "both",
    expected_check_in: at(saturday, "08:00"),
    expected_check_out: at(saturday, "12:00")
  });

  const ws = await WorkSheetModel.findOne({
    user_id: userInfo._id,
    date: moment.tz(saturday, TZ).startOf("day").toDate()
  });
  expect(ws.work_unit).toBe(0.25);
});

test("bộ đếm hợp nhất: 3 ngày thiếu 1 chiều không có đơn + 1 đơn duyệt ở lần thứ 4 -> work_unit = 0.5", async () => {
  const dates = weekdaysInMonth(4);
  const [d1, d2, d3, d4] = dates;

  // 3 ngày đầu: chỉ có check_in (thiếu check_out), không có đơn quên chấm công nào.
  for (const dateKey of [d1, d2, d3]) {
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: moment.tz(dateKey, TZ).startOf("day").toDate(),
      shifts: [],
      check_in: at(dateKey, "08:00")
    });
  }

  // Ngày thứ 4: có đơn quên chấm công (lần đầu tiên của user này) -> nhưng vì bộ đếm
  // hợp nhất đã tính 3 ngày trước đó, đây là occurrence=4 -> vượt giới hạn -> nửa công.
  await approveRequest({
    date: d4,
    type: "both",
    expected_check_in: at(d4, "08:00"),
    expected_check_out: at(d4, "17:30")
  });

  const ws4 = await WorkSheetModel.findOne({
    user_id: userInfo._id,
    date: moment.tz(d4, TZ).startOf("day").toDate()
  });
  expect(ws4.work_unit).toBe(0.5);
});
