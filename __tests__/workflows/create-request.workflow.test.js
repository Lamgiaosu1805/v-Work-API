const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const TZ = "Asia/Ho_Chi_Minh";

jest.mock("../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn()
}));
jest.mock("../../src/helpers/requestUtils", () => {
  const actual = jest.requireActual("../../src/helpers/requestUtils");
  return { ...actual, notify: jest.fn() };
});

const { getApprovalChain } = require("../../src/modules/request/domain/approval-chain");
const { notify } = require("../../src/helpers/requestUtils");
const AccountModel = require("../../src/models/AccountModel");
const UserInfoModel = require("../../src/models/UserInfoModel");
const LeaveBalanceModel = require("../../src/models/LeaveBalanceModel");
const { RequestModel, RemoteRequest, LeaveRequest } = require("../../src/models/RequestModel");
const WorkSheetModel = require("../../src/models/WorkSheetModel");
const ShiftModel = require("../../src/models/ShiftModel");
const leaveSideEffects = require("../../src/workflows/request-side-effects/leave");
const { createRequest } = require("../../src/workflows/create-request.workflow");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await AccountModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await RequestModel.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await ShiftModel.deleteMany({});
  jest.restoreAllMocks();
  getApprovalChain.mockReset();
  notify.mockReset();
});

async function createUserInfo(n) {
  const account = await AccountModel.create({ username: `acc${n}`, password: "x", role: "user" });
  const userInfo = await UserInfoModel.create({
    full_name: `NV ${n}`,
    cccd: `${n}`.padStart(12, "0"),
    phone_number: `090${n}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${n}`,
    employment_type: "fulltime"
  });
  return { account, userInfo };
}

// leaveHandler treats Saturday as a half-day (see calcTotalDays in
// requestUtils.js) and Sunday as non-working — advance until we land on a
// plain weekday (Mon-Fri) so total_days/paid_days assertions are
// deterministic regardless of which day the test actually runs on.
//
// Bug tự phát hiện (flaky, không phải regression từ 1.8.6 — port nguyên từ create-request.test.js gốc):
// bản đầu dùng `new Date()` + `.getDay()` (local system timezone) để check cuối tuần nhưng lại
// `.toISOString()` (UTC) để lấy chuỗi ngày — khi máy chạy test ở giờ local buổi sáng sớm tại timezone
// +07 (Asia/Ho_Chi_Minh), UTC vẫn còn ở NGÀY HÔM TRƯỚC, gây lệch 1 ngày giữa ngày đã check-cuối-tuần
// (local) và chuỗi ngày thực trả về (UTC) — có thể vô tình rơi đúng vào Chủ nhật theo cách
// `calcTotalDays` diễn giải (dùng `moment.tz(dateStr, TZ)`, không phải UTC), làm total_days=0 và
// validate() throw 400 thay vì tạo đơn thành công. Sửa bằng cách dùng moment-timezone nhất quán
// Asia/Ho_Chi_Minh cho CẢ 2 bước (check cuối tuần + tạo chuỗi ngày), không trộn local Date với UTC nữa.
function weekdayFromNow(n) {
  let m = moment.tz(TZ).add(n, "days");
  while (m.day() === 0 || m.day() === 6) {
    m = m.add(1, "day");
  }
  return m.format("YYYY-MM-DD");
}

// Port nguyên __tests__/modules/request/create-request.test.js (task 1.8.6) — orchestration (mở
// transaction + dispatch side-effect xuyên module) đã chuyển từ modules/request/application/
// create-request.service.ts sang workflows/create-request.workflow.ts, giữ nguyên toàn bộ assertion.
// Khác biệt duy nhất: spy onCreate giờ nhắm vào workflows/request-side-effects/leave (nơi logic thật
// đang sống) thay vì helpers/leaveHandler (giờ chỉ còn validate/validateAsync).
describe("createRequest() (workflows/create-request.workflow)", () => {
  it("throw ArgumentInvalidException (400) khi request_type không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    await expect(createRequest(account, { request_type: "not_a_real_type" })).rejects.toMatchObject(
      { statusCode: 400 }
    );
  });

  it("throw NotFoundException (404) khi tài khoản không có hồ sơ nhân viên", async () => {
    const account = await AccountModel.create({
      username: "no-profile",
      password: "x",
      role: "user"
    });
    await expect(
      createRequest(account, {
        request_type: "remote",
        from_date: weekdayFromNow(1),
        to_date: weekdayFromNow(1)
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Không tìm thấy thông tin nhân viên" });
  });

  it("throw ArgumentInvalidException (400) khi handler.validate() báo lỗi input sai (remote thiếu ngày)", async () => {
    const { account } = await createUserInfo(1);
    await expect(createRequest(account, { request_type: "remote" })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("throw ConflictException (409) khi handler.validateAsync() báo trùng lịch (remote overlap)", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(5),
      to_date: weekdayFromNow(6)
    });

    await expect(
      createRequest(account, {
        request_type: "remote",
        reason: "wfh",
        from_date: weekdayFromNow(5),
        to_date: weekdayFromNow(5)
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("201: tạo thành công đơn remote (không có onCreate), notify người duyệt gần nhất sau khi commit", async () => {
    const { account } = await createUserInfo(1);
    const reviewerAccountId = new mongoose.Types.ObjectId();
    getApprovalChain.mockResolvedValue([{ accountId: reviewerAccountId }]);

    const entity = await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(2),
      to_date: weekdayFromNow(3)
    });

    const doc = await RemoteRequest.findById(entity.id);
    expect(doc).not.toBeNull();
    expect(doc.status).toBe("pending");
    expect(doc.reason).toBe("wfh");

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe(reviewerAccountId);
    expect(notify.mock.calls[0][1]).toMatchObject({
      type: "remote_created",
      ref_type: "request"
    });
  });

  it("201: không có ai trong approval chain — không throw, không gọi notify", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    const entity = await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(8),
      to_date: weekdayFromNow(9)
    });

    expect(entity).toBeTruthy();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("201: đơn nghỉ phép unpaid — không có side-effect trừ ngày phép (paid_days = 0)", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    const entity = await createRequest(account, {
      request_type: "leave",
      reason: "viec gia dinh",
      from_date: weekdayFromNow(2),
      from_period: "morning",
      to_date: weekdayFromNow(2),
      to_period: "afternoon",
      leave_type: "unpaid"
    });

    const doc = await LeaveRequest.findById(entity.id);
    expect(doc.paid_days).toBe(0);
    expect(doc.unpaid_days).toBe(1);

    const ledger = await LeaveBalanceModel.find({ ref_id: entity.id });
    expect(ledger).toHaveLength(0);
  });

  it("201: đơn nghỉ phép paid — onCreate trừ đúng số ngày phép vào LeaveBalanceModel, _id map đúng từ entity.id", async () => {
    const { account, userInfo } = await createUserInfo(1);
    await LeaveBalanceModel.create({
      user_id: userInfo._id,
      amount: 5,
      reason: "hr_manual_adjustment",
      balance_after: 5
    });
    getApprovalChain.mockResolvedValue([]);
    const onCreateSpy = jest.spyOn(leaveSideEffects, "onCreate");

    const entity = await createRequest(account, {
      request_type: "leave",
      reason: "viec gia dinh",
      from_date: weekdayFromNow(2),
      from_period: "morning",
      to_date: weekdayFromNow(2),
      to_period: "afternoon",
      leave_type: "paid"
    });

    const doc = await LeaveRequest.findById(entity.id);
    expect(doc.paid_days).toBe(1);

    expect(onCreateSpy).toHaveBeenCalledTimes(1);
    const [passedRequest] = onCreateSpy.mock.calls[0];
    expect(String(passedRequest._id)).toBe(String(entity.id));

    const ledger = await LeaveBalanceModel.find({
      ref_id: entity.id,
      reason: "leave_request_deduction"
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(-1);
  });

  it("rollback: handler.onCreate trả lỗi -> KHÔNG lưu Request document, throw exception đúng status", async () => {
    const { account } = await createUserInfo(1);
    await LeaveBalanceModel.create({
      user_id: (await UserInfoModel.findOne({ id_account: account._id }))._id,
      amount: 5,
      reason: "hr_manual_adjustment",
      balance_after: 5
    });
    jest
      .spyOn(leaveSideEffects, "onCreate")
      .mockResolvedValue({ status: 400, message: "forced error" });

    await expect(
      createRequest(account, {
        request_type: "leave",
        reason: "viec gia dinh",
        from_date: weekdayFromNow(2),
        from_period: "morning",
        to_date: weekdayFromNow(2),
        to_period: "afternoon",
        leave_type: "paid"
      })
    ).rejects.toMatchObject({ statusCode: 400, message: "forced error" });

    const count = await LeaveRequest.countDocuments({});
    expect(count).toBe(0);
  });
});

// Bug thật phát hiện (user báo): tạo nhiều đơn "quên chấm công" liên tiếp trong cùng kỳ công mà CHƯA
// AI DUYỆT cái nào — trước khi sửa, đơn nào cũng ra occurrence=1 (không tăng dần), khiến việc xác định
// ngưỡng "từ lần thứ 6 -> 2 cấp" (SRS) sai hoàn toàn. Gốc rễ: buildUnifiedForgotOccurrenceMap chỉ tự
// nhận diện được ngày thiếu ĐÚNG 1 vế qua worksheet; ngày "quên cả 2" (type=both) không tự nhận diện
// được nếu chưa có đơn NÀO liên quan được duyệt — rơi vào fallback chỉ đếm đơn approved (luôn = 0 lúc
// chưa duyệt gì). Fix: computeForgotOccurrence (forgotCheckinHandler.js) giờ đếm cả đơn "pending" lẫn
// "approved" khi tính occurrence lúc tạo đơn mới.
describe("createRequest() forgot_checkin — occurrence tính đúng khi chưa có đơn nào được duyệt", () => {
  async function seedWorksheet(userId, dateKey, overrides = {}) {
    const shift = await ShiftModel.findOne({}).sort({ createdAt: 1 });
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(dateKey, TZ).startOf("day").toDate(),
      shifts: shift ? [shift._id] : [],
      check_in: null,
      check_out: null,
      ...overrides
    });
  }

  it("8 đơn quên chấm công CẢ 2 vế (type=both) liên tiếp, chưa đơn nào được duyệt: occurrence tăng dần 1..8 (không bị kẹt ở 1)", async () => {
    const { account, userInfo } = await createUserInfo(1);
    await ShiftModel.create({ name: "Ca hành chính", start_time: "08:00", end_time: "17:30" });

    const dates = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10"
    ];
    for (const d of dates) {
      // eslint-disable-next-line no-await-in-loop
      await seedWorksheet(userInfo._id, d);
    }

    const occurrences = [];
    for (const d of dates) {
      // eslint-disable-next-line no-await-in-loop
      const entity = await createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công cả ngày",
        date: d,
        type: "both",
        expected_check_in: moment.tz(`${d} 08:00`, "YYYY-MM-DD HH:mm", TZ).toISOString(),
        expected_check_out: moment.tz(`${d} 17:30`, "YYYY-MM-DD HH:mm", TZ).toISOString()
      });
      occurrences.push(entity.getProps().occurrence);
    }

    expect(occurrences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // occurrence >= 6 -> needsMultiApproval() = true (khớp SRS "từ lần thứ 6")
    expect(occurrences.filter((o) => o >= 6)).toHaveLength(3);
  });
});

// Chỉ chặn tạo đơn khi ngày đã ĐỦ CẢ 2 mốc (thật sự không thiếu gì). Nếu chỉ có 1 mốc vẫn cho tạo —
// máy chấm công chỉ ghi 1 lần quẹt trong ngày có thể gán nhầm vào field check_in dù thực chất là giờ
// ra (khi đó onApprove tự "cứu" giá trị cũ sang field đối diện, xem forgot-checkin-approve.test.ts).
describe("createRequest() forgot_checkin — chặn/không chặn theo dữ liệu check-in/check-out đã có", () => {
  async function seedWorksheet(userId, dateKey, overrides = {}) {
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(dateKey, TZ).startOf("day").toDate(),
      shifts: [],
      check_in: null,
      check_out: null,
      ...overrides
    });
  }

  const dt = (dateKey, hhmm) => moment.tz(`${dateKey} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();
  const iso = (dateKey, hhmm) => dt(dateKey, hhmm).toISOString();

  it("chỉ có check_in (máy ghi nhầm giờ ra vào field check_in), check_out trống: vẫn tạo được đơn 'quên check-in'", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "17:00") });

    const entity = await createRequest(account, {
      request_type: "forgot_checkin",
      reason: "quên chấm công vào",
      date: d,
      type: "check_in",
      expected_check_in: iso(d, "08:00")
    });
    expect(entity.getProps().type).toBe("check_in");
  });

  it("chỉ có check_in, check_out trống: tạo đơn 'quên check-out' bình thường", async () => {
    const { account, userInfo } = await createUserInfo(2);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "08:00") });

    const entity = await createRequest(account, {
      request_type: "forgot_checkin",
      reason: "quên chấm công ra",
      date: d,
      type: "check_out",
      expected_check_out: iso(d, "17:00")
    });
    expect(entity.getProps().type).toBe("check_out");
  });

  it("đã có ĐỦ cả check_in lẫn check_out: bị chặn 409", async () => {
    const { account, userInfo } = await createUserInfo(3);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "08:00"), check_out: dt(d, "17:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công",
        date: d,
        type: "check_in",
        expected_check_in: iso(d, "08:05")
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("type='both' nhưng đã có check_in: bị chặn 409", async () => {
    const { account, userInfo } = await createUserInfo(4);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "08:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công",
        date: d,
        type: "both",
        expected_check_in: iso(d, "08:00"),
        expected_check_out: iso(d, "17:00")
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("type='both' nhưng đã có check_out: bị chặn 409", async () => {
    const { account, userInfo } = await createUserInfo(5);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_out: dt(d, "17:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công",
        date: d,
        type: "both",
        expected_check_in: iso(d, "08:00"),
        expected_check_out: iso(d, "17:00")
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("type='both', chưa có gì cả: tạo được bình thường", async () => {
    const { account, userInfo } = await createUserInfo(6);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d);

    const entity = await createRequest(account, {
      request_type: "forgot_checkin",
      reason: "quên chấm công cả ngày",
      date: d,
      type: "both",
      expected_check_in: iso(d, "08:00"),
      expected_check_out: iso(d, "17:00")
    });
    expect(entity.getProps().type).toBe("both");
  });
});

// Giờ dự kiến phải hợp lý so với mốc THẬT còn lại đã có trong hệ thống (vế đối diện với vế đang xin
// sửa) — tránh tạo đơn với giờ vô lý (vd xin check-in sau cả giờ check-out thật đã ghi nhận).
describe("createRequest() forgot_checkin — giờ dự kiến phải hợp lý so với mốc còn lại đã có", () => {
  async function seedWorksheet(userId, dateKey, overrides = {}) {
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(dateKey, TZ).startOf("day").toDate(),
      shifts: [],
      check_in: null,
      check_out: null,
      ...overrides
    });
  }

  const dt = (dateKey, hhmm) => moment.tz(`${dateKey} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();
  const iso = (dateKey, hhmm) => dt(dateKey, hhmm).toISOString();

  it("quên check-in nhưng giờ xin lại SAU giờ check-out thật đã có: bị chặn 400", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_out: dt(d, "17:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công vào",
        date: d,
        type: "check_in",
        expected_check_in: iso(d, "18:00")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("quên check-in, giờ xin BẰNG giờ check-out thật đã có: bị chặn 400 (isSameOrAfter)", async () => {
    const { account, userInfo } = await createUserInfo(2);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_out: dt(d, "17:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công vào",
        date: d,
        type: "check_in",
        expected_check_in: iso(d, "17:00")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("quên check-in, giờ xin TRƯỚC giờ check-out thật đã có: tạo được bình thường", async () => {
    const { account, userInfo } = await createUserInfo(3);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_out: dt(d, "17:00") });

    const entity = await createRequest(account, {
      request_type: "forgot_checkin",
      reason: "quên chấm công vào",
      date: d,
      type: "check_in",
      expected_check_in: iso(d, "08:00")
    });
    expect(entity.getProps().type).toBe("check_in");
  });

  it("quên check-out nhưng giờ xin lại TRƯỚC giờ check-in thật đã có: bị chặn 400", async () => {
    const { account, userInfo } = await createUserInfo(4);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "08:00") });

    await expect(
      createRequest(account, {
        request_type: "forgot_checkin",
        reason: "quên chấm công ra",
        date: d,
        type: "check_out",
        expected_check_out: iso(d, "07:00")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("quên check-out, giờ xin sau giờ check-in thật đã có: tạo được bình thường", async () => {
    const { account, userInfo } = await createUserInfo(5);
    const d = "2026-07-01";
    await seedWorksheet(userInfo._id, d, { check_in: dt(d, "08:00") });

    const entity = await createRequest(account, {
      request_type: "forgot_checkin",
      reason: "quên chấm công ra",
      date: d,
      type: "check_out",
      expected_check_out: iso(d, "17:00")
    });
    expect(entity.getProps().type).toBe("check_out");
  });
});

// Conflict check của client_visit đổi từ "trùng ngày" sang "trùng khung giờ" — nhiều đơn gặp khách
// khác giờ trong cùng 1 ngày phải tạo được, chỉ chặn khi 2 khung giờ thực sự chồng nhau.
describe("createRequest() client_visit — conflict theo khung giờ, không phải theo ngày", () => {
  it("2 đơn cùng ngày, KHÔNG trùng giờ (08:00-10:00 và 14:00-16:00): tạo được cả 2", async () => {
    const { account } = await createUserInfo(1);
    const d = "2026-07-01";

    await createRequest(account, {
      request_type: "client_visit",
      reason: "gặp khách A",
      visit_date: d,
      start_time: "08:00",
      end_time: "10:00"
    });

    const second = await createRequest(account, {
      request_type: "client_visit",
      reason: "gặp khách B",
      visit_date: d,
      start_time: "14:00",
      end_time: "16:00"
    });
    expect(second.getProps().start_time).toBe("14:00");
  });

  it("2 đơn cùng ngày, giờ nối tiếp sát nhau (08:00-10:00 và 10:00-12:00): KHÔNG coi là trùng", async () => {
    const { account } = await createUserInfo(2);
    const d = "2026-07-01";

    await createRequest(account, {
      request_type: "client_visit",
      reason: "gặp khách A",
      visit_date: d,
      start_time: "08:00",
      end_time: "10:00"
    });

    const second = await createRequest(account, {
      request_type: "client_visit",
      reason: "gặp khách B",
      visit_date: d,
      start_time: "10:00",
      end_time: "12:00"
    });
    expect(second.getProps().start_time).toBe("10:00");
  });

  it("2 đơn cùng ngày, TRÙNG khung giờ (08:00-10:00 và 09:00-11:00): đơn thứ 2 bị chặn 409", async () => {
    const { account } = await createUserInfo(3);
    const d = "2026-07-01";

    await createRequest(account, {
      request_type: "client_visit",
      reason: "gặp khách A",
      visit_date: d,
      start_time: "08:00",
      end_time: "10:00"
    });

    await expect(
      createRequest(account, {
        request_type: "client_visit",
        reason: "gặp khách B",
        visit_date: d,
        start_time: "09:00",
        end_time: "11:00"
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
