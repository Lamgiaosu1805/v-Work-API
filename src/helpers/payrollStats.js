const moment = require("moment-timezone");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const { buildHolidayDefaultWorkUnitMap } = require("../modules/timesheet");
const { correctDayStatuses } = require("./attendanceHelper");
const { calcStandardWorkUnits } = require("./payrollPeriod");

const TZ = "Asia/Ho_Chi_Minh";

// Kỳ công của tháng M/Y: 26 tháng trước → 25 tháng này (giờ VN)
function getPayrollPeriodByMonth(month, year) {
  const refDate = moment.tz({ year, month: month - 1, day: 1 }, TZ);
  return {
    periodStart: refDate.clone().subtract(1, "month").date(26).startOf("day"),
    periodEnd: refDate.clone().date(25).endOf("day")
  };
}

function isHolidayInScope(holiday, branchId) {
  if (holiday.scope_type === "all") return true;
  return !!branchId && (holiday.branches || []).some((b) => b.toString() === branchId.toString());
}

/**
 * Tính công theo kỳ cho danh sách nhân viên — dùng chung cho GET /attendance/payroll-stats-all
 * và xuất Excel bảng công nhân sự.
 *
 * @param {object} input
 * @param {Array} input.users             UserInfo docs (cần _id, ma_nv, full_name, probation_end_date,
 *                                        employment_type, branch_id)
 * @param {moment.Moment} input.periodStart
 * @param {moment.Moment} input.periodEnd
 * @param {boolean} [input.includeDaily]  true → mỗi row có thêm `daily`: Map "YYYY-MM-DD" →
 *                                        { work_unit, statuses, is_holiday } cho mọi ngày trong kỳ
 * @returns {Promise<{ rows: object[], holidays: object[] }>}
 */
async function buildPayrollRows({ users, periodStart, periodEnd, includeDaily = false }) {
  const userIds = users.map((u) => u._id);

  const [worksheets, dayStatuses, holidays] = await Promise.all([
    WorkSheetModel.find({
      user_id: { $in: userIds },
      date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
      isDeleted: false
    }),
    WorkDayStatusModel.find({
      user_id: { $in: userIds },
      date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
      isDeleted: false
    }),
    HolidayModel.find({
      date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
      isDeleted: false
    })
  ]);

  const standardUnitsByBranch = new Map();
  const standardUnitsForBranch = (branchId) => {
    const key = branchId ? branchId.toString() : "";
    if (!standardUnitsByBranch.has(key)) {
      standardUnitsByBranch.set(
        key,
        calcStandardWorkUnits({ periodStart, periodEnd, holidays, branchId }).standard_work_units
      );
    }
    return standardUnitsByBranch.get(key);
  };

  // Gap SRS: ngày lễ (paid) mặc định hiển thị 1 công dù không ai chấm công ngày đó — chỉ điền vào
  // ngày CHƯA có worksheet nào (không ghi đè work_unit đã tính từ luồng khác). Khớp cách fix ở
  // getPayrollStats (1 nhân viên).
  const holidaySnapshots = holidays.map((h) => ({
    date: h.date,
    pay_policy: h.pay_policy,
    scope_type: h.scope_type,
    branches: (h.branches || []).map((b) => b.toString())
  }));
  const holidayDefaultMapByBranch = new Map();
  const holidayDefaultMapForBranch = (branchId) => {
    const key = branchId ? branchId.toString() : "";
    if (!holidayDefaultMapByBranch.has(key)) {
      holidayDefaultMapByBranch.set(
        key,
        buildHolidayDefaultWorkUnitMap(holidaySnapshots, branchId ? branchId.toString() : null)
      );
    }
    return holidayDefaultMapByBranch.get(key);
  };

  const wsByUser = new Map();
  for (const ws of worksheets) {
    const k = ws.user_id.toString();
    if (!wsByUser.has(k)) wsByUser.set(k, []);
    wsByUser.get(k).push(ws);
  }
  const dsByUser = new Map();
  for (const ds of dayStatuses) {
    const k = ds.user_id.toString();
    if (!dsByUser.has(k)) dsByUser.set(k, []);
    dsByUser.get(k).push(ds);
  }

  const rows = users.map((u) => {
    const uid = u._id.toString();
    // Ngày nghỉ việc = ngày làm việc cuối cùng (vẫn tính công) → mọi dữ liệu công SAU ngày đó bị bỏ
    // qua (kể cả worksheet đã lỡ tạo khi HR nhập ngày nghỉ muộn, và công mặc định ngày lễ sau khi nghỉ)
    const lastWorkingKey = u.resignation_date
      ? moment.tz(u.resignation_date, TZ).format("YYYY-MM-DD")
      : null;
    const isEmployedOn = (dateKey) => !lastWorkingKey || dateKey <= lastWorkingKey;
    const dateKeyOf = (date) => moment.tz(date, TZ).format("YYYY-MM-DD");

    const wss = (wsByUser.get(uid) || []).filter((ws) => isEmployedOn(dateKeyOf(ws.date)));
    const dss = (dsByUser.get(uid) || []).filter((ds) => isEmployedOn(dateKeyOf(ds.date)));

    const wsByDate = new Map();
    for (const ws of wss) {
      wsByDate.set(moment.tz(ws.date, TZ).format("YYYY-MM-DD"), ws);
    }
    const dsByDate = new Map();
    for (const ds of dss) {
      const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
      if (!dsByDate.has(key)) dsByDate.set(key, []);
      dsByDate.get(key).push(ds);
    }

    const probationEnd = u.probation_end_date
      ? moment.tz(u.probation_end_date, TZ).startOf("day")
      : null;

    let work_unit_total = 0;
    let work_unit_official = 0;
    let work_unit_probation = 0;
    let penalty_amount_total = 0;
    let late_days = 0;
    let total_minutes_late = 0;
    let early_days = 0;
    let total_minutes_early = 0;

    for (const ws of wss) {
      const wu = ws.work_unit ?? 0;
      work_unit_total += wu;
      const isProbation = probationEnd && moment.tz(ws.date, TZ).isBefore(probationEnd, "day");
      if (isProbation) work_unit_probation += wu;
      else work_unit_official += wu;
      penalty_amount_total += ws.penalty_amount ?? 0;
      if ((ws.minutes_late ?? 0) > 0) {
        late_days++;
        total_minutes_late += ws.minutes_late;
      }
      if ((ws.minute_early ?? 0) > 0) {
        early_days++;
        total_minutes_early += ws.minute_early;
      }
    }

    const holidayDefaultMap = holidayDefaultMapForBranch(u.branch_id);
    for (const [dateStr, wu] of holidayDefaultMap) {
      if (wsByDate.has(dateStr) || !isEmployedOn(dateStr)) continue;
      work_unit_total += wu;
      const isProbation = probationEnd && moment.tz(dateStr, TZ).isBefore(probationEnd, "day");
      if (isProbation) work_unit_probation += wu;
      else work_unit_official += wu;
    }

    let present_days = 0;
    let missed_clock_days = 0;
    let absent_days = 0;
    let leave_paid_days = 0;
    let leave_unpaid_days = 0;
    let remote_days = 0;
    let business_trip_days = 0;
    let client_visit_days = 0;
    const correctedByDate = new Map();
    for (const [dateKey, statusesOfDate] of dsByDate) {
      const corrected = correctDayStatuses(statusesOfDate, wsByDate.get(dateKey));
      correctedByDate.set(dateKey, corrected);
      const isSaturday = moment.tz(dateKey, TZ).day() === 6;
      for (const s of corrected) {
        const w = s.period === "full" ? 1 : 0.5;
        if (s.status === "present") present_days += w;
        // "Quên chấm" đếm theo SỐ LẦN (nguyên), không theo trọng số buổi — mỗi buổi/ngày quên = 1.
        else if (s.status === "missed_clock") missed_clock_days += 1;
        else if (s.status === "absent") absent_days += w;
        // Thứ 7 chỉ làm buổi sáng: đơn nghỉ lưu period "full" nhưng chỉ trừ 0,5 phép — đếm khớp quỹ phép
        else if (s.status === "leave_paid") leave_paid_days += isSaturday ? 0.5 : w;
        else if (s.status === "leave_unpaid") leave_unpaid_days += w;
        else if (s.status === "remote") remote_days += w;
        else if (s.status === "business_trip") business_trip_days += w;
        else if (s.status === "client_visit") client_visit_days += w;
      }
    }

    const row = {
      user_id: u._id,
      ma_nv: u.ma_nv,
      full_name: u.full_name,
      employment_type: u.employment_type,
      probation_end_date: u.probation_end_date
        ? moment.tz(u.probation_end_date, TZ).format("DD/MM/YYYY")
        : null,
      resignation_date: u.resignation_date
        ? moment.tz(u.resignation_date, TZ).format("DD/MM/YYYY")
        : null,
      standard_work_units: standardUnitsForBranch(u.branch_id),
      work_unit_total,
      work_unit_official,
      work_unit_probation,
      penalty_amount_total,
      present_days,
      missed_clock_days,
      absent_days,
      leave_paid_days,
      leave_unpaid_days,
      remote_days,
      business_trip_days,
      client_visit_days,
      late_days,
      total_minutes_late,
      early_days,
      total_minutes_early
    };

    if (includeDaily) {
      const holidayDates = new Set(
        holidays
          .filter((h) => isHolidayInScope(h, u.branch_id))
          .map((h) => moment.tz(h.date, TZ).format("YYYY-MM-DD"))
      );
      const daily = new Map();
      const cursor = periodStart.clone().startOf("day");
      while (cursor.isSameOrBefore(periodEnd, "day")) {
        const key = cursor.format("YYYY-MM-DD");
        const ws = wsByDate.get(key);
        daily.set(
          key,
          isEmployedOn(key)
            ? {
                // null = chưa chốt công (worksheet chưa được tính) — khác với 0 công
                work_unit: ws ? ws.work_unit : (holidayDefaultMap.get(key) ?? null),
                statuses: correctedByDate.get(key) || [],
                is_holiday: holidayDates.has(key)
              }
            : // Đã nghỉ việc → ô trống (không ghi K / L)
              { work_unit: null, statuses: [], is_holiday: false }
        );
        cursor.add(1, "day");
      }
      row.daily = daily;
    }

    return row;
  });

  return { rows, holidays };
}

module.exports = { buildPayrollRows, getPayrollPeriodByMonth, TZ };
