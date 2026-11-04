import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getHrmOverview } from "../src/services/hrmOverview.service";
import UserInfoModel from "../src/models/UserInfoModel";
import DepartmentModel from "../src/models/DepartmentModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";

const TZ = "Asia/Ho_Chi_Minh";
let mongod: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  seq = 0;
  await Promise.all(
    [UserInfoModel, DepartmentModel, UserDepartmentPositionModel, WorkDayStatusModel].map((m) =>
      (m as mongoose.Model<any>).deleteMany({})
    )
  );
});

const makeUser = (extra: Record<string, unknown> = {}) => {
  seq += 1;
  return UserInfoModel.create({
    full_name: `NV ${seq}`,
    cccd: `0000000000${seq}`,
    phone_number: `090000000${seq}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: `NV${seq}`,
    employment_type: "fulltime",
    ...extra
  });
};

const makeDepartment = (name: string) => {
  seq += 1;
  return DepartmentModel.create({ department_name: name, department_code: `D${seq}` });
};

const assign = (user: any, department: any, position = new mongoose.Types.ObjectId()) =>
  UserDepartmentPositionModel.create({ user: user._id, department: department._id, position });

const markDay = (
  user: any,
  day: moment.Moment,
  status: string,
  period: "full" | "morning" | "afternoon" = "full"
) =>
  WorkDayStatusModel.create({
    user_id: user._id,
    worksheet_id: new mongoose.Types.ObjectId(),
    date: day.clone().startOf("day").toDate(),
    period,
    status
  });

describe("getHrmOverview", () => {
  test("DB trống: toàn bộ số liệu bằng 0 và biểu đồ đủ 6 tháng", async () => {
    const data = await getHrmOverview();

    expect(data.total_employees.count).toBe(0);
    expect(data.active_today.count).toBe(0);
    expect(data.on_leave.count).toBe(0);
    expect(data.new_hires.count).toBe(0);
    expect(data.departments).toEqual([]);
    expect(data.attendance_chart.labels).toHaveLength(6);
    expect(data.attendance_chart.present).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("tổng nhân viên bỏ người đã nghỉ việc và đã xóa, còn người sắp nghỉ vẫn tính", async () => {
    await makeUser();
    await makeUser({ resignation_date: moment.tz(TZ).subtract(3, "days").toDate() });
    await makeUser({ resignation_date: moment.tz(TZ).add(10, "days").toDate() });
    await makeUser({ isDeleted: true });

    const data = await getHrmOverview();

    expect(data.total_employees.count).toBe(2);
  });

  test("tuyển mới tháng này và so với tháng trước", async () => {
    const now = moment.tz(TZ);
    await makeUser({ start_date: now.clone().startOf("month").add(1, "hour").toDate() });
    await makeUser({ start_date: now.clone().startOf("month").add(2, "hour").toDate() });
    await makeUser({
      start_date: now.clone().subtract(1, "month").startOf("month").add(1, "day").toDate()
    });

    const data = await getHrmOverview();

    expect(data.new_hires.count).toBe(2);
    expect(data.new_hires.change_vs_last_month).toBe(1);
  });

  test("biến động nhân sự so với đầu tháng", async () => {
    const now = moment.tz(TZ);
    await makeUser({ start_date: now.clone().subtract(2, "months").toDate() });
    await makeUser({ start_date: now.clone().startOf("month").add(1, "hour").toDate() });

    const data = await getHrmOverview();

    expect(data.total_employees.count).toBe(2);
    expect(data.total_employees.change_since_month_start).toBe(1);
  });

  test("đang làm việc / đang nghỉ phép hôm nay đếm theo người, không đếm theo buổi", async () => {
    const today = moment.tz(TZ);
    const [a, b, c, d] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    await markDay(a, today, "present");
    await markDay(b, today, "remote");
    await markDay(c, today, "leave_paid", "morning");
    await markDay(c, today, "leave_unpaid", "afternoon");
    await markDay(d, today, "absent");
    await markDay(d, today.clone().subtract(1, "day"), "leave_paid");

    const data = await getHrmOverview();

    expect(data.active_today.count).toBe(2);
    expect(data.on_leave.count).toBe(1);
    expect(data.on_leave.change_vs_yesterday).toBe(0);
  });

  test("biểu đồ chấm công: nửa buổi tính 0.5 ngày công, tháng hiện tại nằm cuối", async () => {
    const today = moment.tz(TZ).startOf("day");
    const user = await makeUser();
    await markDay(user, today, "present");
    await markDay(user, today.clone().subtract(1, "day").startOf("day"), "absent", "morning");
    const lastMonth = today.clone().subtract(1, "month").startOf("month").add(1, "day");
    await markDay(user, lastMonth, "business_trip");

    const { attendance_chart: chart } = await getHrmOverview();

    expect(chart.labels[5]).toBe(`T${today.month() + 1}`);
    expect(chart.present[4]).toBe(1);
    expect(chart.present[5]).toBeGreaterThanOrEqual(1);
    const lastDayIsThisMonth = today.clone().subtract(1, "day").month() === today.month();
    if (lastDayIsThisMonth) expect(chart.absent[5]).toBe(0.5);
    else expect(chart.absent[4]).toBe(0.5);
  });

  test("nhân sự theo phòng ban: đếm người 1 lần dù nhiều chức vụ, bỏ người nghỉ việc, sắp theo số lượng", async () => {
    const sales = await makeDepartment("Kinh doanh");
    const tech = await makeDepartment("Kỹ thuật");
    const a = await makeUser();
    const b = await makeUser();
    const gone = await makeUser({ resignation_date: moment.tz(TZ).subtract(1, "day").toDate() });
    await assign(a, sales);
    await assign(a, sales);
    await assign(b, sales);
    await assign(gone, tech);
    await assign(b, tech);

    const { departments } = await getHrmOverview();

    expect(departments.map((d) => [d.name, d.count])).toEqual([
      ["Kinh doanh", 2],
      ["Kỹ thuật", 1]
    ]);
  });
});
