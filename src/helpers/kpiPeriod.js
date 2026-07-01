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

module.exports = { pad2, monthKey, dayKey, monthRange };
