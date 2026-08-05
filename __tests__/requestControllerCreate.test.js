const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  requestHttpController
} = require("../src/modules/request/interface/request.http.controller");
const { asyncHandler } = require("../src/core/http/async-handler");
const { errorHandlerMiddleware } = require("../src/core/http/error-handler.middleware");
const UserInfoModel = require("../src/models/UserInfoModel");
const AccountModel = require("../src/models/AccountModel");
const { RequestModel } = require("../src/models/RequestModel");
const WorkSheetModel = require("../src/models/WorkSheetModel");
const WorkDayStatusModel = require("../src/models/WorkDayStatusModel");
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");
const ShiftModel = require("../src/models/ShiftModel");
const { getLeaveBalance } = require("../src/modules/leave");
const { LEAVE_BALANCE_REASON } = require("../src/constants");

const TZ = "Asia/Ho_Chi_Minh";

let mongod;

beforeAll(async () => {
  // RequestController.create dùng mongoose.startSession().startTransaction() —
  // cần replica set (dù chỉ 1 node) thì MongoDB mới hỗ trợ transaction.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());

  // Model nào chưa từng được query (vd HolidayModel trong leaveHandler.validateAsync)
  // sẽ khiến MongoDB tự tạo collection NGAY TRONG transaction lần đầu gọi tới —
  // dễ dính race với autoIndex chạy nền (lỗi "Unable to acquire IX lock ... within 5ms").
  // .init() ép đợi collection + index dựng xong trước khi test chạy, tránh race này.
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
}, 60000);

afterAll(async () => {
  // createRequest/reviewRequest publish domain event fire-and-forget (không await) —
  // đợi 1 nhịp để notify của lần gọi cuối cùng kịp query xong trước khi ngắt kết nối,
  // tránh "MongoClientClosedError: Operation interrupted" do disconnect giữa chừng.
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  await mongoose.disconnect();
  await mongod.stop();
});

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

// Gọi đúng như Express thật sẽ gọi: asyncHandler bắt reject rồi chuyển cho
// errorHandlerMiddleware format response — tái dùng nguyên request.http.controller.js +
// core/http thay vì gọi thẳng RequestController.js (đã xoá ở task 1.15).
async function callController(action, req, res) {
  await asyncHandler(action)(req, res, (error) => errorHandlerMiddleware(error, req, res));
}

// calcTotalDays/buildWorkDatesWithStatus tính khác nhau cho T7 (weight 0.5) và Chủ Nhật
// (bỏ qua hẳn) so với ngày thường (weight 1) — test cần 1 ngày thường bất kỳ, không phụ
// thuộc thứ mấy trong tuần lúc chạy test. Tìm ngày làm việc gần nhất từ minDaysAhead trở đi.
function nextWeekday(minDaysAhead) {
  let m = moment.tz(TZ).add(minDaysAhead, "day");
  while (m.day() === 0 || m.day() === 6) {
    m = m.add(1, "day");
  }
  return m.format("YYYY-MM-DD");
}

// Bảo vệ trực tiếp việc handler.validate() (nay là async — xem leaveHandler.js)
// phải được `await` ở RequestController.create. Nếu ai đó lỡ bỏ `await`,
// `payload`/`error` sẽ destructure từ 1 Promise chưa resolve: `error` luôn
// undefined (không throw), `payload` luôn undefined -> RequestModel.create
// nhận `...undefined` sẽ throw TypeError -> response 500 thay vì 201.
test("tạo đơn leave unpaid: validate() được await đúng, trả 201 (không phải 500)", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên",
    cccd: "111111111111",
    phone_number: "0911111111",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ01",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const nextDay = nextWeekday(1);

  const req = {
    account: { _id: employeeAccount._id },
    body: {
      request_type: "leave",
      // Không còn truyền assigned_reviewer — người duyệt tự tính động qua approvalChain,
      // đơn phải tạo được bình thường kể cả khi không có ai trong chuỗi (xem 2.3 của plan).
      reason: "test",
      from_date: nextDay,
      from_period: "morning",
      to_date: nextDay,
      to_period: "afternoon",
      leave_type: "unpaid"
    }
  };
  const res = makeRes();

  await callController(requestHttpController.create, req, res);

  expect(res.status).not.toHaveBeenCalledWith(500);
  expect(res.status).toHaveBeenCalledWith(201);

  const created = await RequestModel.findOne({ user_id: employeeInfo._id });
  expect(created).not.toBeNull();
  expect(created.unpaid_days).toBe(1);
});

// Regression: leaveHandler.validateAsync từng tính fromDate/toDate qua
// moment.tz(date, TZ).startOf("day") (nửa đêm giờ VN) để query đơn trùng ngày, trong
// khi RequestModel.from_date/to_date thực tế lưu qua Mongoose auto-cast chuỗi
// "YYYY-MM-DD" trực tiếp (nửa đêm UTC) — lệch nhau 7 tiếng khiến query trùng ngày
// luôn miss, cho phép tạo 2 đơn nghỉ phép cùng ngày mà không bị chặn.
test("tạo 2 đơn nghỉ phép trùng đúng 1 ngày: đơn thứ 2 phải bị chặn 409", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_overlap_test",
    password: "hashed",
    role: "user"
  });
  await UserInfoModel.create({
    full_name: "Nhân viên trùng đơn",
    cccd: "222222222222",
    phone_number: "0922222222",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ02",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const sameDay = nextWeekday(2);
  const baseBody = {
    request_type: "leave",
    reason: "test overlap",
    from_date: sameDay,
    from_period: "morning",
    to_date: sameDay,
    to_period: "afternoon",
    leave_type: "unpaid"
  };

  const firstRes = makeRes();
  await callController(
    requestHttpController.create,
    { account: { _id: employeeAccount._id }, body: { ...baseBody } },
    firstRes
  );
  expect(firstRes.status).toHaveBeenCalledWith(201);

  const secondRes = makeRes();
  await callController(
    requestHttpController.create,
    { account: { _id: employeeAccount._id }, body: { ...baseBody } },
    secondRes
  );
  expect(secondRes.status).toHaveBeenCalledWith(409);
  expect(secondRes.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Đã có đơn nghỉ trong khoảng thời gian này" })
  );
});

// "Đi công tác" là request_type riêng ("business_trip", không còn dùng chung "remote"
// + category) — xác nhận tạo đơn thành công với đúng request_type.
test("tạo đơn business_trip: 201, request_type lưu đúng", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_trip_test",
    password: "hashed",
    role: "user"
  });
  await UserInfoModel.create({
    full_name: "Nhân viên công tác",
    cccd: "333333333333",
    phone_number: "0933333333",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ03",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const fromDate = nextWeekday(1);
  const toDate = nextWeekday(3);

  const req = {
    account: { _id: employeeAccount._id },
    body: {
      request_type: "business_trip",
      reason: "công tác Đà Nẵng",
      from_date: fromDate,
      to_date: toDate
    }
  };
  const res = makeRes();

  await callController(requestHttpController.create, req, res);

  expect(res.status).toHaveBeenCalledWith(201);

  const created = await RequestModel.findOne({
    user_id: (await UserInfoModel.findOne({ ma_nv: "NVREQ03" }))._id,
    request_type: "business_trip"
  });
  expect(created).not.toBeNull();
});

// Regression: onApprove của business_trip/client_visit phải set check_in/check_out/
// work_unit trên WorkSheet (như 1 ngày đi làm đủ), không chỉ đánh dấu WorkDayStatus
// như remoteHandler cũ — để "Bảng công" hiện đủ giờ/công thay vì trống.
test("duyệt đơn business_trip: WorkSheet có check_in/check_out/work_unit đủ, WorkDayStatus đúng", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_trip_approve_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên công tác duyệt",
    cccd: "555555555555",
    phone_number: "0955555555",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ05",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const adminAccount = await AccountModel.create({
    username: "admin_trip_approve_test",
    password: "hashed",
    role: "admin"
  });
  await UserInfoModel.create({
    full_name: "Admin duyệt",
    cccd: "666666666666",
    phone_number: "0966666666",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: adminAccount._id,
    ma_nv: "ADMIN01",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const fromDate = nextWeekday(1);
  const toDate = nextWeekday(1);

  const createRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "business_trip",
        reason: "công tác",
        from_date: fromDate,
        to_date: toDate
      }
    },
    createRes
  );
  expect(createRes.status).toHaveBeenCalledWith(201);

  const created = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "business_trip"
  });

  const reviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: created._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    reviewRes
  );
  expect(reviewRes.status).toHaveBeenCalledWith(200);

  const dayStart = moment.tz(fromDate, TZ).startOf("day").toDate();
  const worksheet = await WorkSheetModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart
  });
  expect(worksheet).not.toBeNull();
  expect(worksheet.check_in).not.toBeNull();
  expect(worksheet.check_out).not.toBeNull();
  expect(worksheet.work_unit).toBeGreaterThan(0);

  const dayStatus = await WorkDayStatusModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart,
    period: "full"
  });
  expect(dayStatus).not.toBeNull();
  expect(dayStatus.status).toBe("business_trip");
});

// Regression: forgotCheckinHandler.validateAsync từng chặn cứng khi WorkSheet ngày đó
// đã có check_in/check_out (kể cả dữ liệu sai do máy chấm công lỗi) — không cho nhân
// viên tự nộp đơn sửa. Giờ phải tạo được, tin vào bước duyệt làm hàng rào.
test("tạo đơn quên chấm công dù WorkSheet đã có check_in (sửa dữ liệu sai): vẫn 201", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_forgot_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên quên chấm công",
    cccd: "444444444444",
    phone_number: "0944444444",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ04",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const targetDate = nextWeekday(1);
  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  // Giá trị sai do máy chấm công lỗi — không hợp lý cho 1 giờ check-in thật.
  const wrongCheckIn = moment.tz(`${targetDate} 18:01`, "YYYY-MM-DD HH:mm", TZ).toDate();
  await WorkSheetModel.create({
    user_id: employeeInfo._id,
    date: dayStart,
    shifts: [],
    check_in: wrongCheckIn
  });

  const expectedCheckIn = moment.tz(`${targetDate} 08:00`, "YYYY-MM-DD HH:mm", TZ).toISOString();

  const req = {
    account: { _id: employeeAccount._id },
    body: {
      request_type: "forgot_checkin",
      reason: "máy chấm công lỗi, giờ ghi sai",
      date: targetDate,
      type: "check_in",
      expected_check_in: expectedCheckIn
    }
  };
  const res = makeRes();

  await callController(requestHttpController.create, req, res);

  expect(res.status).toHaveBeenCalledWith(201);

  const created = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "forgot_checkin"
  });
  expect(created).not.toBeNull();
  expect(created.status).toBe("pending");
});

async function makeAdminReviewer(username, maNv, branchId) {
  const adminAccount = await AccountModel.create({ username, password: "hashed", role: "admin" });
  await UserInfoModel.create({
    full_name: "Admin duyệt",
    cccd: `${Date.now()}`.slice(-12).padStart(12, "0"),
    phone_number: "0977777777",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: adminAccount._id,
    ma_nv: maNv,
    employment_type: "fulltime",
    branch_id: branchId
  });
  return adminAccount;
}

// Regression: leaveHandler.onApprove chỉ đánh dấu WorkDayStatus="leave_paid", không set
// WorkSheet.work_unit — khiến "Bảng công" hiện 0 công cho ngày nghỉ phép có lương dù đã
// duyệt. Giờ phải set work_unit đủ (giống 1 ngày đi làm), như đã làm với công tác/gặp KH.
test("duyệt đơn nghỉ phép có lương (1 ngày): WorkSheet.work_unit phải đủ (không còn 0)", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_leave_wu_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên nghỉ phép",
    cccd: "777777777777",
    phone_number: "0977777771",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ06",
    employment_type: "fulltime",
    branch_id: branchId
  });
  await LeaveBalanceModel.create({
    user_id: employeeInfo._id,
    amount: 5,
    reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
  });

  const adminAccount = await makeAdminReviewer("admin_leave_wu_test", "ADMIN02", branchId);

  const targetDate = nextWeekday(1);

  const createRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "leave",
        reason: "nghỉ phép",
        from_date: targetDate,
        from_period: "morning",
        to_date: targetDate,
        to_period: "afternoon",
        leave_type: "paid"
      }
    },
    createRes
  );
  expect(createRes.status).toHaveBeenCalledWith(201);

  const created = await RequestModel.findOne({ user_id: employeeInfo._id, request_type: "leave" });

  const reviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: created._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    reviewRes
  );
  expect(reviewRes.status).toHaveBeenCalledWith(200);

  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  const worksheet = await WorkSheetModel.findOne({ user_id: employeeInfo._id, date: dayStart });
  expect(worksheet).not.toBeNull();
  expect(worksheet.work_unit).toBe(1);
});

// Regression: tạo đơn công tác/gặp KH đúng ngày đã có nghỉ phép có lương được duyệt
// phải tự hoàn lại paid_days đã trừ trước đó (awayDayHandler giờ gọi
// resolveLeaveConflictOnAttendance, giống leaveHandler/forgotCheckinHandler).
test("duyệt đơn business_trip đè lên ngày đã nghỉ phép có lương: status đổi đúng + hoàn phép", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_leave_override_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên nghỉ phép rồi công tác",
    cccd: "888888888888",
    phone_number: "0988888881",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ07",
    employment_type: "fulltime",
    branch_id: branchId
  });
  await LeaveBalanceModel.create({
    user_id: employeeInfo._id,
    amount: 5,
    reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
  });

  const adminAccount = await makeAdminReviewer("admin_leave_override_test", "ADMIN03", branchId);

  const targetDate = nextWeekday(1);
  const balanceBefore = await getLeaveBalance(employeeInfo._id);

  // 1. Tạo + duyệt đơn nghỉ phép có lương cho targetDate.
  const leaveCreateRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "leave",
        reason: "nghỉ phép",
        from_date: targetDate,
        from_period: "morning",
        to_date: targetDate,
        to_period: "afternoon",
        leave_type: "paid"
      }
    },
    leaveCreateRes
  );
  expect(leaveCreateRes.status).toHaveBeenCalledWith(201);
  const leaveRequest = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "leave"
  });

  const leaveReviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: leaveRequest._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    leaveReviewRes
  );
  expect(leaveReviewRes.status).toHaveBeenCalledWith(200);

  const balanceAfterLeave = await getLeaveBalance(employeeInfo._id);
  expect(balanceAfterLeave).toBeLessThan(balanceBefore);

  // 2. Tạo + duyệt đơn business_trip đúng ngày đó — kỳ vọng tự hoàn lại phép.
  const tripCreateRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "business_trip",
        reason: "công tác đột xuất",
        from_date: targetDate,
        to_date: targetDate
      }
    },
    tripCreateRes
  );
  expect(tripCreateRes.status).toHaveBeenCalledWith(201);
  const tripRequest = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "business_trip"
  });

  const tripReviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: tripRequest._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    tripReviewRes
  );
  expect(tripReviewRes.status).toHaveBeenCalledWith(200);

  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  const dayStatus = await WorkDayStatusModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart,
    period: "full"
  });
  expect(dayStatus).not.toBeNull();
  expect(dayStatus.status).toBe("business_trip");

  const balanceAfterTrip = await getLeaveBalance(employeeInfo._id);
  expect(balanceAfterTrip).toBe(balanceBefore);
});

// Regression: leaveHandler.onApprove dùng findOneAndUpdate({date, period}) để set
// WorkDayStatus — nếu nghỉ phép là NỬA NGÀY (period="morning") trong khi bản ghi cũ
// (từ business_trip đã duyệt trước đó) là period="full", filter không khớp nên tạo
// thêm bản ghi mới thay vì ghi đè, để sót bản ghi "business_trip" cũ khiến Bảng công
// hiện sai. Đồng thời check_in/check_out cũ từ công tác cũng phải bị xoá sạch.
test("duyệt đơn nghỉ phép (nửa ngày) đè lên ngày đã có công tác: dọn sạch status/check-in-out cũ", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_trip_then_leave_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên công tác rồi nghỉ phép",
    cccd: "999999999999",
    phone_number: "0999999991",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ08",
    employment_type: "fulltime",
    branch_id: branchId
  });
  await LeaveBalanceModel.create({
    user_id: employeeInfo._id,
    amount: 5,
    reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
  });

  const adminAccount = await makeAdminReviewer("admin_trip_then_leave_test", "ADMIN04", branchId);

  const targetDate = nextWeekday(1);

  // 1. Tạo + duyệt đơn business_trip cho targetDate — status=business_trip, có check_in/out.
  const tripCreateRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "business_trip",
        reason: "công tác",
        from_date: targetDate,
        to_date: targetDate
      }
    },
    tripCreateRes
  );
  expect(tripCreateRes.status).toHaveBeenCalledWith(201);
  const tripRequest = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "business_trip"
  });

  const tripReviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: tripRequest._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    tripReviewRes
  );
  expect(tripReviewRes.status).toHaveBeenCalledWith(200);

  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  const worksheetAfterTrip = await WorkSheetModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart
  });
  expect(worksheetAfterTrip.check_in).not.toBeNull();
  expect(worksheetAfterTrip.check_out).not.toBeNull();

  // 2. Tạo + duyệt đơn nghỉ phép NỬA NGÀY (buổi sáng) cho đúng ngày đó.
  const leaveCreateRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "leave",
        reason: "nghỉ phép buổi sáng",
        from_date: targetDate,
        from_period: "morning",
        to_date: targetDate,
        to_period: "morning",
        leave_type: "paid"
      }
    },
    leaveCreateRes
  );
  expect(leaveCreateRes.status).toHaveBeenCalledWith(201);
  const leaveRequest = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "leave"
  });

  const leaveReviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: leaveRequest._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    leaveReviewRes
  );
  expect(leaveReviewRes.status).toHaveBeenCalledWith(200);

  // Chỉ còn đúng 1 bản ghi WorkDayStatus cho ngày đó — không còn "business_trip" sót lại.
  const allStatuses = await WorkDayStatusModel.find({
    user_id: employeeInfo._id,
    date: dayStart
  });
  expect(allStatuses).toHaveLength(1);
  expect(allStatuses[0].status).toBe("leave_paid");

  const worksheetAfterLeave = await WorkSheetModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart
  });
  expect(worksheetAfterLeave.check_in).toBeNull();
  expect(worksheetAfterLeave.check_out).toBeNull();
  expect(worksheetAfterLeave.work_unit).toBe(0.5);
});

// Regression (bảo vệ hành vi cũ không bị phá khi sửa bug trên): nếu ngày đó đã có
// chấm công THẬT (status "present", không phải công tác/gặp KH) thì duyệt đơn nghỉ
// phép KHÔNG được xoá check_in/check_out — phải để resolveLeaveConflictOnAttendance
// tự phát hiện đã có mặt thật, ghi đè nghỉ phép về lại "present" + hoàn phép.
test("duyệt đơn nghỉ phép đè lên ngày đã CHẤM CÔNG THẬT: giữ nguyên check-in/out, tự hoàn phép", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_real_attendance_leave_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên đã chấm công thật",
    cccd: "111122223333",
    phone_number: "0911122223",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ09",
    employment_type: "fulltime",
    branch_id: branchId
  });
  await LeaveBalanceModel.create({
    user_id: employeeInfo._id,
    amount: 5,
    reason: LEAVE_BALANCE_REASON.HR_MANUAL_ADJUSTMENT
  });

  const adminAccount = await makeAdminReviewer(
    "admin_real_attendance_leave_test",
    "ADMIN05",
    branchId
  );

  const targetDate = nextWeekday(1);
  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  const realCheckIn = moment.tz(`${targetDate} 08:00`, "YYYY-MM-DD HH:mm", TZ).toDate();
  const realCheckOut = moment.tz(`${targetDate} 17:00`, "YYYY-MM-DD HH:mm", TZ).toDate();

  // resolveLeaveConflictOnAttendance cần lastShiftEnd (từ shift gắn trên worksheet)
  // để tính coversAfternoon — worksheet thật luôn có shift (cron gán mỗi ngày),
  // test phải mô phỏng đúng, nếu không coversAfternoon luôn false, không bao giờ
  // ghi đè được.
  const shift = await ShiftModel.create({
    name: "Ca hành chính test",
    start_time: "08:00",
    end_time: "17:00"
  });
  const worksheet = await WorkSheetModel.create({
    user_id: employeeInfo._id,
    date: dayStart,
    shifts: [shift._id],
    check_in: realCheckIn,
    check_out: realCheckOut,
    work_unit: 1
  });
  await WorkDayStatusModel.create({
    user_id: employeeInfo._id,
    worksheet_id: worksheet._id,
    date: dayStart,
    period: "full",
    status: "present",
    sources: [{ ref_id: worksheet._id, ref_type: "attendance" }]
  });

  const balanceBefore = await getLeaveBalance(employeeInfo._id);

  const leaveCreateRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "leave",
        reason: "nghỉ phép dù đã chấm công",
        from_date: targetDate,
        from_period: "morning",
        to_date: targetDate,
        to_period: "afternoon",
        leave_type: "paid"
      }
    },
    leaveCreateRes
  );
  expect(leaveCreateRes.status).toHaveBeenCalledWith(201);
  const leaveRequest = await RequestModel.findOne({
    user_id: employeeInfo._id,
    request_type: "leave"
  });

  const balanceAfterCreate = await getLeaveBalance(employeeInfo._id);
  expect(balanceAfterCreate).toBeLessThan(balanceBefore);

  const leaveReviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: leaveRequest._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    leaveReviewRes
  );
  expect(leaveReviewRes.status).toHaveBeenCalledWith(200);

  const dayStatus = await WorkDayStatusModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart,
    period: "full"
  });
  expect(dayStatus.status).toBe("present");

  const worksheetAfter = await WorkSheetModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart
  });
  expect(worksheetAfter.check_in).toEqual(realCheckIn);
  expect(worksheetAfter.check_out).toEqual(realCheckOut);

  const balanceAfterApprove = await getLeaveBalance(employeeInfo._id);
  expect(balanceAfterApprove).toBe(balanceBefore);
});

// remoteHandler.onApprove giờ tái dùng awayDayHandler.createOnApprove("remote") —
// mirror đúng test đã có cho business_trip, xác nhận check_in/check_out/work_unit
// được set đủ (không còn chỉ đánh dấu WorkDayStatus trơn như bản cũ).
test("duyệt đơn remote (làm việc từ xa): WorkSheet có check_in/check_out/work_unit đủ", async () => {
  const branchId = new mongoose.Types.ObjectId();

  const employeeAccount = await AccountModel.create({
    username: "employee_remote_test",
    password: "hashed",
    role: "user"
  });
  const employeeInfo = await UserInfoModel.create({
    full_name: "Nhân viên làm từ xa",
    cccd: "222233334444",
    phone_number: "0922233334",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: "NVREQ10",
    employment_type: "fulltime",
    branch_id: branchId
  });

  const adminAccount = await makeAdminReviewer("admin_remote_test", "ADMIN06", branchId);

  const targetDate = nextWeekday(1);

  const createRes = makeRes();
  await callController(
    requestHttpController.create,
    {
      account: { _id: employeeAccount._id },
      body: {
        request_type: "remote",
        reason: "làm việc từ xa",
        from_date: targetDate,
        to_date: targetDate
      }
    },
    createRes
  );
  expect(createRes.status).toHaveBeenCalledWith(201);
  const created = await RequestModel.findOne({ user_id: employeeInfo._id, request_type: "remote" });

  const reviewRes = makeRes();
  await callController(
    requestHttpController.review,
    {
      params: { id: created._id.toString() },
      account: { _id: adminAccount._id, role: "admin" },
      body: { action: "approve" }
    },
    reviewRes
  );
  expect(reviewRes.status).toHaveBeenCalledWith(200);

  const dayStart = moment.tz(targetDate, TZ).startOf("day").toDate();
  const worksheet = await WorkSheetModel.findOne({ user_id: employeeInfo._id, date: dayStart });
  expect(worksheet.check_in).not.toBeNull();
  expect(worksheet.check_out).not.toBeNull();
  expect(worksheet.work_unit).toBe(1);

  const dayStatus = await WorkDayStatusModel.findOne({
    user_id: employeeInfo._id,
    date: dayStart,
    period: "full"
  });
  expect(dayStatus.status).toBe("remote");
});
