const moment = require("moment-timezone");

const TZ = "Asia/Ho_Chi_Minh";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthRange(year, month) {
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 1, 0, 0, 0, 0)
  };
}

function weekKey(date) {
  const m = moment.tz(date, TZ);
  return `${m.isoWeekYear()}-W${pad2(m.isoWeek())}`;
}

function weekRange(weekKeyStr) {
  const [year, week] = weekKeyStr.split("-W");
  const start = moment.tz(TZ).isoWeekYear(Number(year)).isoWeek(Number(week)).startOf("isoWeek");
  return { start: start.toDate(), end: start.clone().add(7, "days").toDate() };
}

module.exports = { pad2, monthKey, dayKey, monthRange, weekKey, weekRange };
