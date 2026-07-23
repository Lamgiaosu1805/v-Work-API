const moment = require("moment-timezone");

const TZ = "Asia/Ho_Chi_Minh";

function getPayrollPeriodRange(refDate) {
  const ref = moment.tz(refDate, TZ);
  if (ref.date() >= 26) {
    return {
      start: ref.clone().date(26).startOf("day").toDate(),
      end: ref.clone().add(1, "month").date(25).endOf("day").toDate()
    };
  }
  return {
    start: ref.clone().subtract(1, "month").date(26).startOf("day").toDate(),
    end: ref.clone().date(25).endOf("day").toDate()
  };
}

function calcStandardWorkUnits({ periodStart, periodEnd, holidays = [], branchId = null }) {
  const applicableHolidays = holidays.filter((h) => {
    if (h.scope_type === "all") return true;
    return branchId && h.branches.some((b) => b.toString() === branchId.toString());
  });

  const holidayMap = new Map();
  for (const h of applicableHolidays) {
    holidayMap.set(moment.tz(h.date, TZ).format("YYYY-MM-DD"), h.duration_days ?? 1);
  }

  let weekdays = 0;
  let saturdays = 0;
  let holidayDeduction = 0;

  const cursor = moment.tz(periodStart, TZ).clone().startOf("day");
  const end = moment.tz(periodEnd, TZ);
  while (cursor.isSameOrBefore(end, "day")) {
    const day = cursor.day();
    if (day !== 0) {
      const key = cursor.format("YYYY-MM-DD");
      if (holidayMap.has(key)) {
        holidayDeduction += day === 6 ? 0.5 : holidayMap.get(key);
      } else if (day === 6) {
        saturdays++;
      } else {
        weekdays++;
      }
    }
    cursor.add(1, "day");
  }

  return {
    standard_work_units: weekdays * 1 + saturdays * 0.5,
    weekdays,
    saturdays,
    holiday_count: applicableHolidays.length,
    holiday_deduction: holidayDeduction
  };
}

module.exports = { getPayrollPeriodRange, calcStandardWorkUnits };
