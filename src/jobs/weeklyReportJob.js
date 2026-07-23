const cron = require("node-cron");
const moment = require("moment-timezone");
const DepartmentModel = require("../models/DepartmentModel");
const { LEAF_TYPES } = require("../models/DepartmentModel");
const WeeklyReportModel = require("../models/WeeklyReportModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const UserInfoModel = require("../models/UserInfoModel");
const pushNotification = require("../helpers/pushNotification");

const TZ = "Asia/Ho_Chi_Minh";

function getWeekStart() {
  return moment().tz(TZ).startOf("isoWeek").toDate(); // Thứ 2 00:00
}

function getDeadline() {
  return moment()
    .tz(TZ)
    .startOf("isoWeek")
    .add(4, "days")
    .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
    .toDate(); // Thứ 6 17:00
}

async function getAccountIdsInDept(deptId) {
  const memberships = await UserDepartmentPositionModel.find({
    department: deptId,
    isDeleted: false
  }).select("user");
  const userIds = memberships.map((m) => m.user);
  const users = await UserInfoModel.find({ _id: { $in: userIds }, isDeleted: false }).select(
    "id_account"
  );
  return users.map((u) => u.id_account);
}

async function notifyDept(deptId, title, body, data = {}) {
  const accountIds = await getAccountIdsInDept(deptId);
  await Promise.allSettled(
    accountIds.map((id) => pushNotification.sendToAccount({ account_id: id, title, body, data }))
  );
}

function registerWeeklyReportJobs() {
  // Thứ 6 lúc 8:00 — tạo record pending cho dept chưa có + nhắc nhở chưa nộp
  cron.schedule(
    "0 8 * * 5",
    async () => {
      try {
        const departments = await DepartmentModel.find({
          isDeleted: false,
          type: { $in: LEAF_TYPES }
        });
        const weekStart = getWeekStart();
        const deadline = getDeadline();
        const deadlineStr = moment(deadline).tz(TZ).format("HH:mm DD/MM/YYYY");

        let created = 0;
        const pendingDeptIds = [];

        for (const dept of departments) {
          let report = await WeeklyReportModel.findOne({
            department: dept._id,
            weekStart,
            isDeleted: false
          });

          if (!report) {
            report = await WeeklyReportModel.create({
              department: dept._id,
              weekStart,
              deadline,
              status: "pending"
            });
            created++;
          }

          if (report.status === "pending") {
            pendingDeptIds.push(dept._id);
          }
        }

        // Gửi notification cho các dept chưa nộp
        await Promise.allSettled(
          pendingDeptIds.map((deptId) =>
            notifyDept(
              deptId,
              "Nhắc nhở: Báo cáo tuần",
              `Hôm nay là hạn chót! Vui lòng nộp báo cáo tuần trước ${deadlineStr}.`,
              { type: "weekly_report_reminder" }
            )
          )
        );

        console.log(
          `[Weekly Report] Thứ 6 8:00 — Tạo mới ${created} record, nhắc ${pendingDeptIds.length} phòng ban chưa nộp`
        );
      } catch (err) {
        console.error("[Weekly Report] Lỗi cron 8:00:", err.message);
      }
    },
    { timezone: TZ }
  );

  // Thứ 6 lúc 17:00 — chốt deadline, đánh dấu missing
  cron.schedule(
    "0 17 * * 5",
    async () => {
      try {
        const weekStart = getWeekStart();
        const pendingReports = await WeeklyReportModel.find({
          weekStart,
          status: "pending",
          isDeleted: false
        }).select("department");

        if (pendingReports.length === 0) {
          console.log("[Weekly Report] Thứ 6 18:00 — Tất cả phòng ban đã nộp báo cáo");
          return;
        }

        await WeeklyReportModel.updateMany(
          { weekStart, status: "pending", isDeleted: false },
          { status: "missing" }
        );

        // Thông báo các phòng ban bị đánh missing
        await Promise.allSettled(
          pendingReports.map(({ department }) =>
            notifyDept(
              department,
              "Đã hết hạn nộp báo cáo",
              "Phòng ban bạn chưa nộp báo cáo tuần. Vẫn có thể nộp muộn nhưng sẽ bị ghi nhận trễ hạn.",
              { type: "weekly_report_missing" }
            )
          )
        );

        console.log(
          `[Weekly Report] Thứ 6 17:00 — Đánh dấu ${pendingReports.length} phòng ban không nộp (missing)`
        );
      } catch (err) {
        console.error("[Weekly Report] Lỗi cron 18:00:", err.message);
      }
    },
    { timezone: TZ }
  );
}

module.exports = { registerWeeklyReportJobs };
