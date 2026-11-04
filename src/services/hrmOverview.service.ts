import moment from "moment-timezone";
import UserInfoModel from "../models/UserInfoModel";
import UserDepartmentPositionModel from "../models/UserDepartmentPositionModel";
import DepartmentModel from "../models/DepartmentModel";
import WorkDayStatusModel from "../models/WorkDayStatusModel";

const TZ = "Asia/Ho_Chi_Minh";
const CHART_MONTH_COUNT = 6;
const TOP_DEPARTMENT_LIMIT = 8;

// Trạng thái ngày công tính là "có mặt làm việc" (đi làm, làm từ xa, công tác, gặp khách hàng).
const WORKING_STATUSES = ["present", "remote", "business_trip", "client_visit"];
const LEAVE_STATUSES = ["leave_paid", "leave_unpaid"];

const round1 = (n: number) => Math.round(n * 10) / 10;

// Nhân viên còn làm việc tại thời điểm `at`: chưa nghỉ việc hoặc ngày nghỉ việc sau `at`.
const activeAt = (at: Date) => ({
  isDeleted: false,
  $or: [{ resignation_date: null }, { resignation_date: { $gt: at } }]
});

const countDistinctUsersOnDay = async (day: moment.Moment, statuses: string[]) => {
  const users = await WorkDayStatusModel.distinct("user_id", {
    isDeleted: false,
    date: { $gte: day.clone().startOf("day").toDate(), $lt: day.clone().endOf("day").toDate() },
    status: { $in: statuses }
  });
  return users.length;
};

const countHiredBetween = (from: moment.Moment, to: moment.Moment) =>
  UserInfoModel.countDocuments({
    isDeleted: false,
    start_date: { $gte: from.toDate(), $lt: to.toDate() }
  });

// Số nhân viên còn làm việc vào đầu `at` (tính theo ngày vào/nghỉ việc).
const countHeadcountAt = (at: moment.Moment) =>
  UserInfoModel.countDocuments({
    isDeleted: false,
    $and: [
      { $or: [{ start_date: null }, { start_date: { $lt: at.toDate() } }] },
      { $or: [{ resignation_date: null }, { resignation_date: { $gte: at.toDate() } }] }
    ]
  });

const buildAttendanceChart = async (now: moment.Moment) => {
  const months = Array.from({ length: CHART_MONTH_COUNT }, (_, i) =>
    now
      .clone()
      .startOf("month")
      .subtract(CHART_MONTH_COUNT - 1 - i, "months")
  );
  const since = months[0].toDate();

  // Ngày công: cả ngày = 1, nửa buổi = 0.5.
  const dayWeight = { $cond: [{ $eq: ["$period", "full"] }, 1, 0.5] };
  const rows: { _id: { y: number; m: number }; present: number; absent: number }[] =
    await WorkDayStatusModel.aggregate([
      { $match: { isDeleted: false, date: { $gte: since } } },
      {
        $group: {
          _id: {
            y: { $year: { date: "$date", timezone: TZ } },
            m: { $month: { date: "$date", timezone: TZ } }
          },
          present: {
            $sum: { $cond: [{ $in: ["$status", WORKING_STATUSES] }, dayWeight, 0] }
          },
          absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, dayWeight, 0] } }
        }
      }
    ]);

  const byMonth = new Map(rows.map((r) => [`${r._id.y}-${r._id.m}`, r]));
  const found = months.map((m) => byMonth.get(`${m.year()}-${m.month() + 1}`));
  return {
    labels: months.map((m) => `T${m.month() + 1}`),
    present: found.map((r) => round1(r?.present ?? 0)),
    absent: found.map((r) => round1(r?.absent ?? 0))
  };
};

const buildDepartmentHeadcount = async (now: Date) => {
  const userCollection = UserInfoModel.collection.name;
  const departmentCollection = DepartmentModel.collection.name;

  const rows: { _id: string; name: string; count: number }[] =
    await UserDepartmentPositionModel.aggregate([
      { $match: { isDeleted: false } },
      {
        $lookup: { from: userCollection, localField: "user", foreignField: "_id", as: "employee" }
      },
      { $unwind: "$employee" },
      {
        $match: {
          "employee.isDeleted": false,
          $or: [
            { "employee.resignation_date": null },
            { "employee.resignation_date": { $gt: now } }
          ]
        }
      },
      // Một người có thể giữ nhiều chức vụ trong cùng phòng ban: chỉ đếm 1 lần.
      { $group: { _id: { department: "$department", user: "$user" } } },
      { $group: { _id: "$_id.department", count: { $sum: 1 } } },
      {
        $lookup: {
          from: departmentCollection,
          localField: "_id",
          foreignField: "_id",
          as: "department"
        }
      },
      { $unwind: "$department" },
      { $match: { "department.isDeleted": false } },
      { $project: { name: "$department.department_name", count: 1 } },
      { $sort: { count: -1, name: 1 } },
      { $limit: TOP_DEPARTMENT_LIMIT }
    ]);

  return rows.map((r) => ({ id: String(r._id), name: r.name, count: r.count }));
};

export async function getHrmOverview() {
  const now = moment.tz(TZ);
  const monthStart = now.clone().startOf("month");
  const nextMonthStart = monthStart.clone().add(1, "month");
  const prevMonthStart = monthStart.clone().subtract(1, "month");
  const yesterday = now.clone().subtract(1, "day");

  const [
    totalEmployees,
    headcountAtMonthStart,
    activeToday,
    onLeaveToday,
    onLeaveYesterday,
    newHires,
    newHiresPrevMonth,
    attendanceChart,
    departments
  ] = await Promise.all([
    UserInfoModel.countDocuments(activeAt(now.toDate())),
    countHeadcountAt(monthStart),
    countDistinctUsersOnDay(now, WORKING_STATUSES),
    countDistinctUsersOnDay(now, LEAVE_STATUSES),
    countDistinctUsersOnDay(yesterday, LEAVE_STATUSES),
    countHiredBetween(monthStart, nextMonthStart),
    countHiredBetween(prevMonthStart, monthStart),
    buildAttendanceChart(now),
    buildDepartmentHeadcount(now.toDate())
  ]);

  return {
    generated_at: now.toISOString(),
    total_employees: {
      count: totalEmployees,
      change_since_month_start: totalEmployees - headcountAtMonthStart
    },
    active_today: { count: activeToday },
    on_leave: { count: onLeaveToday, change_vs_yesterday: onLeaveToday - onLeaveYesterday },
    new_hires: { count: newHires, change_vs_last_month: newHires - newHiresPrevMonth },
    attendance_chart: attendanceChart,
    departments
  };
}
