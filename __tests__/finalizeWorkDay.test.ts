import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import moment from "moment-timezone";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import ShiftModel from "../src/models/ShiftModel";
import AttendancePenaltyModel from "../src/models/AttendancePenaltyModel";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await ShiftModel.deleteMany({});
  await AttendancePenaltyModel.deleteMany({});
});

// Đây là characterization test ĐẦU TIÊN cho jobs/finalizeWorkDay.js (chưa từng có test nào trước khi
// cutover ở task 1.8.3.6) — bắt buộc phải có trước khi tin tưởng việc thay resolveAttendanceDay/
// saveAttendanceDay bằng modules/timesheet's processAttendanceDay.
describe("finalizeWorkDay", () => {
  test("worksheet có check_in/check_out: được xử lý, work_unit=1, tạo status 'full' present", async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { finalizeWorkDay } = require("../src/jobs/finalizeWorkDay");

    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: moment.tz(`${DATE_KEY} 08:01`, "YYYY-MM-DD HH:mm", TZ).toDate(),
      check_out: moment.tz(`${DATE_KEY} 17:31`, "YYYY-MM-DD HH:mm", TZ).toDate()
    });

    await finalizeWorkDay(DATE_KEY);

    const updated = await WorkSheetModel.findById(worksheet._id).lean();
    expect(updated?.work_unit).toBe(1);
    expect(updated?.minutes_late).toBe(1);

    const statuses = await WorkDayStatusModel.find({ user_id: userId }).lean();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].period).toBe("full");
    expect(statuses[0].status).toBe("present");
  });

  test("worksheet KHÔNG có check_in lẫn check_out: bị loại khỏi truy vấn, không xử lý", async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { finalizeWorkDay } = require("../src/jobs/finalizeWorkDay");

    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });

    await finalizeWorkDay(DATE_KEY);

    const updated = await WorkSheetModel.findById(worksheet._id).lean();
    expect(updated?.work_unit).toBeNull(); // không đổi gì
  });

  test("đi muộn theo tier cấu hình thật: phạt tiền đúng, work_unit vẫn = 1", async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { finalizeWorkDay } = require("../src/jobs/finalizeWorkDay");

    await AttendancePenaltyModel.create({
      type: "late",
      from_minutes: 1,
      to_minutes: 30,
      penalty_kind: "money",
      penalty_value: 50000,
      effective_from: new Date("2020-01-01T00:00:00+07:00"),
      is_active: true
    });

    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const worksheet = await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: moment.tz(`${DATE_KEY} 08:20`, "YYYY-MM-DD HH:mm", TZ).toDate(), // muộn 20 phút
      check_out: moment.tz(`${DATE_KEY} 17:31`, "YYYY-MM-DD HH:mm", TZ).toDate()
    });

    await finalizeWorkDay(DATE_KEY);

    const updated = await WorkSheetModel.findById(worksheet._id).lean();
    expect(updated?.penalty_amount).toBe(50000);
    expect(updated?.work_unit).toBe(1);
  });

  test("dọn status 'pending' còn sót thành 'absent' sau khi xử lý xong", async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { finalizeWorkDay } = require("../src/jobs/finalizeWorkDay");

    const userId = new mongoose.Types.ObjectId();
    const pendingDoc = await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: new mongoose.Types.ObjectId(),
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      period: "full",
      status: "pending",
      sources: []
    });

    await finalizeWorkDay(DATE_KEY);

    const updated = await WorkDayStatusModel.findById(pendingDoc._id);
    expect(updated?.status).toBe("absent");
  });
});
