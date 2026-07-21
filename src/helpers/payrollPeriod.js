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

module.exports = { getPayrollPeriodRange };
