import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { onApprove } from "../src/helpers/lateEarlyHandler";
import { LateEarlyRequest } from "../src/models/RequestModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import ShiftModel from "../src/models/ShiftModel";
import AttendancePenaltyModel from "../src/models/AttendancePenaltyModel";

const TZ = "Asia/Ho_Chi_Minh";
const DATE_KEY = "2026-07-01"; // thứ 4

const at = (hhmm: string) => moment.tz(`${DATE_KEY} ${hhmm}`, "YYYY-MM-DD HH:mm", TZ).toDate();

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());

  await AttendancePenaltyModel.create({
    type: "late",
    from_minutes: 1,
    to_minutes: 30,
    penalty_kind: "money",
    penalty_value: 50000,
    effective_from: new Date("2020-01-01T00:00:00+07:00"),
    is_active: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await LateEarlyRequest.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await ShiftModel.deleteMany({});
  await AttendancePenaltyModel.deleteMany({
    _id: { $exists: true },
    type: { $ne: "late" }
  });
});

// Chưa từng có test nào cho lateEarlyHandler.js's onApprove trước khi cutover (task 1.8.3.6) —
// characterization test mới, viết trước khi tin tưởng cutover.
describe("lateEarlyHandler.onApprove", () => {
  test("duyệt đơn đi muộn có lý do: miễn phạt (lateForgivenSet), work_unit=1, penalty=0", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: at("08:20"), // muộn 20 phút
      check_out: at("17:31")
    });
    const request = await LateEarlyRequest.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shift_id: shift._id,
      type: "late",
      minutes: 20,
      status: "approved"
    });

    await onApprove(request, null);

    const ws = await WorkSheetModel.findOne({ user_id: userId }).lean();
    expect(ws?.penalty_amount).toBe(0); // được miễn phạt vì có đơn đã duyệt
    expect(ws?.work_unit).toBe(1);
  });

  test("không có worksheet cho ngày đó: không làm gì, không lỗi", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const request = await LateEarlyRequest.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shift_id: shift._id,
      type: "late",
      minutes: 20,
      status: "approved"
    });

    await expect(onApprove(request, null)).resolves.not.toThrow();
    expect(await WorkSheetModel.countDocuments({ user_id: userId })).toBe(0);
  });

  test("worksheet không có check_in lẫn check_out: không xử lý gì (giữ nguyên work_unit)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    await WorkSheetModel.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shifts: [shift._id],
      check_in: null,
      check_out: null
    });
    const request = await LateEarlyRequest.create({
      user_id: userId,
      date: moment.tz(DATE_KEY, TZ).startOf("day").toDate(),
      shift_id: shift._id,
      type: "late",
      minutes: 20,
      status: "approved"
    });

    await onApprove(request, null);

    const ws = await WorkSheetModel.findOne({ user_id: userId }).lean();
    expect(ws?.work_unit).toBeNull();
  });
});
