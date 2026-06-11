const mongoose = require("mongoose");
const moment = require("moment-timezone");
const xlsx = require("xlsx");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const { resolveLeaveConflictOnAttendance } = require("./leaveHandler");

const TZ = "Asia/Ho_Chi_Minh";
const EMPLOYEE_HEADER_REGEX = /Mã nhân viên:\s*(\S+)/;
const DATE_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME_REGEX = /^\d{2}:\d{2}/;


function parseExcelToBlocks(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const headers = [];
  for (let i = 0; i < rows.length; i++) {
    const match = String(rows[i][0] || "").match(EMPLOYEE_HEADER_REGEX);
    if (match) headers.push({ machine_code: match[1], startRow: i });
  }

  return headers.map((h, idx) => {
    const nextStart =
      idx + 1 < headers.length ? headers[idx + 1].startRow : rows.length;
    return {
      machine_code: h.machine_code,
      rows: rows.slice(h.startRow + 1, nextStart),
    };
  });
}


function parseDayRows(block) {
  const dayRows = [];
  for (const row of block.rows) {
    const dateStr = String(row[0] || "").trim();
    if (!DATE_REGEX.test(dateStr)) continue;
    const inCell = [row[2], row[4], row[6]].find((v) =>
      TIME_REGEX.test(String(v).trim()),
    );
    const outCell = [row[7], row[5], row[3]].find((v) =>
      TIME_REGEX.test(String(v).trim()),
    );
    dayRows.push({
      dateStr,
      rawIn: inCell ? String(inCell).trim().slice(0, 5) : null,
      rawOut: outCell ? String(outCell).trim().slice(0, 5) : null,
    });
  }
  return dayRows;
}


function resolveAttendanceDay({
  dateKey,
  rawIn,
  rawOut,
  worksheet,
  forgotMap,
  forgotCountMap,
  lateForgivenSet,
  leavePeriodsMap,
  resolveLatePenalty,
  resolveForgotPenalty,
}) {
  const forgot = forgotMap.get(dateKey);

  if (!rawIn && !rawOut && !forgot) return { skip: true };
  if (!worksheet) return { skip: true };

  const dateMoment = moment.tz(dateKey, TZ).startOf("day");
  const dayStart = dateMoment.toDate();

  const machineIn = rawIn
    ? moment.tz(`${dateKey} ${rawIn}`, "YYYY-MM-DD HH:mm", TZ).toDate()
    : null;
  const machineOut = rawOut
    ? moment.tz(`${dateKey} ${rawOut}`, "YYYY-MM-DD HH:mm", TZ).toDate()
    : null;

  let newCheckIn = machineIn;
  let newCheckOut = machineOut;
  if (!newCheckIn && worksheet.check_in) newCheckIn = worksheet.check_in;
  if (!newCheckOut && worksheet.check_out) newCheckOut = worksheet.check_out;
  if (forgot) {
    if (forgot.type === "check_in" || forgot.type === "both")
      newCheckIn = worksheet.check_in;
    if (forgot.type === "check_out" || forgot.type === "both")
      newCheckOut = worksheet.check_out;
  }

  const hasIn = !!newCheckIn;
  const hasOut = !!newCheckOut;
  if (!hasIn && !hasOut) return { skip: true };

  const isSaturday = dateMoment.day() === 6;
  const forgiven = lateForgivenSet.has(dateKey);

  let lastShiftEnd = null;
  if (worksheet.shifts?.length) {
    const lastShift = worksheet.shifts[worksheet.shifts.length - 1];
    lastShiftEnd = lastShift?.end_time ?? null;
  }

  const leavePeriods = leavePeriodsMap?.get(dateKey);
  let leaveMorning =
    !!leavePeriods && (leavePeriods.has("morning") || leavePeriods.has("full"));
  let leaveAfternoon =
    !!leavePeriods &&
    (leavePeriods.has("afternoon") || leavePeriods.has("full"));
  if (hasIn && hasOut) {
    if (leaveMorning) {
      const noon = moment.tz(dateKey, TZ).hour(12).minute(0).second(0);
      if (moment.tz(newCheckIn, TZ).isBefore(noon)) leaveMorning = false;
    }
    if (leaveAfternoon && lastShiftEnd) {
      const [endH, endM] = lastShiftEnd.split(":").map(Number);
      const threshold = moment
        .tz(dateKey, TZ)
        .hour(endH)
        .minute(endM)
        .second(0)
        .subtract(60, "minutes");
      if (moment.tz(newCheckOut, TZ).isSameOrAfter(threshold))
        leaveAfternoon = false;
    }
  }
  const leaveDeduction = Math.min(
    isSaturday ? 0.5 : 1,
    (leaveMorning ? 0.5 : 0) + (leaveAfternoon ? 0.5 : 0),
  );
  const missedIn = !hasIn && !leaveMorning;
  const missedOut = !hasOut && !leaveAfternoon;

  let minutesLate = 0;
  const firstShift = worksheet.shifts && worksheet.shifts[0];
  if (hasIn && !leaveMorning && firstShift && firstShift.start_time) {
    const [sh, sm] = firstShift.start_time.split(":").map(Number);
    const shiftStart = moment.tz(dateKey, TZ).hour(sh).minute(sm).second(0);
    minutesLate = Math.max(
      0,
      Math.floor((moment.tz(newCheckIn, TZ) - shiftStart) / 60000),
    );
  }
  if (forgiven) minutesLate = 0;

  let work_unit;
  let penalty_amount = 0;
  let morning_absent = false;
  if (missedIn || missedOut) {
    work_unit = 0;
  } else if (forgot) {
    const occurrence = forgotCountMap?.get(dateKey) || 0;
    const r = resolveForgotPenalty(dayStart, occurrence, isSaturday);
    work_unit = Math.max(0, r.work_unit - leaveDeduction);
    penalty_amount = r.penalty_amount;
  } else if (forgiven) {
    work_unit = Math.max(0, (isSaturday ? 0.5 : 1) - leaveDeduction);
  } else {
    const r = resolveLatePenalty(dayStart, minutesLate, isSaturday);
    work_unit = Math.max(0, r.work_unit - leaveDeduction);
    penalty_amount = r.penalty_amount;
    morning_absent = r.morning_absent;
  }

  const sameTime = (a, b) =>
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  const unchanged =
    sameTime(worksheet.check_in, newCheckIn) &&
    sameTime(worksheet.check_out, newCheckOut) &&
    (worksheet.minutes_late ?? 0) === minutesLate &&
    (worksheet.work_unit ?? null) === work_unit &&
    (worksheet.penalty_amount ?? 0) === penalty_amount;
  if (unchanged) return { skip: true, unchanged: true };

  worksheet.check_in = newCheckIn;
  worksheet.check_out = newCheckOut;
  worksheet.minutes_late = minutesLate;
  worksheet.work_unit = work_unit;
  worksheet.penalty_amount = penalty_amount;

  return {
    skip: false,
    newCheckIn,
    newCheckOut,
    minutesLate,
    work_unit,
    penalty_amount,
    morning_absent,
    hasIn,
    hasOut,
    missedIn,
    missedOut,
    lastShiftEnd,
  };
}

async function saveAttendanceDay({ userId, dateKey, worksheet, computed }) {
  const dateMoment = moment.tz(dateKey, TZ).startOf("day");
  const dayStart = dateMoment.toDate();
  const dayEnd = moment(dateMoment).add(1, "day").toDate();

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await worksheet.save({ session });

    await resolveLeaveConflictOnAttendance({
      userId,
      worksheetId: worksheet._id,
      date: dateKey,
      checkInTime: computed.newCheckIn,
      checkOutTime: computed.newCheckOut,
      lastShiftEnd: computed.lastShiftEnd,
      session,
    });

    const OVERRIDABLE = ["pending", "missed_clock", "absent"];

    if (computed.morning_absent) {
      await WorkDayStatusModel.deleteMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: OVERRIDABLE },
        },
        { session },
      );
      for (const [period, st] of [
        ["morning", "absent"],
        ["afternoon", "present"],
      ]) {
        await WorkDayStatusModel.updateOne(
          { user_id: userId, date: dayStart, period },
          {
            $setOnInsert: {
              worksheet_id: worksheet._id,
              status: st,
              sources: [{ ref_id: worksheet._id, ref_type: "attendance" }],
              isDeleted: false,
            },
          },
          { upsert: true, session },
        );
      }
    } else {
      const complete = !computed.missedIn && !computed.missedOut;
      const newStatus = complete ? "present" : "missed_clock";
      await WorkDayStatusModel.updateMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: OVERRIDABLE },
          isDeleted: false,
        },
        { status: newStatus },
        { session },
      );
    }

    await session.commitTransaction();
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

module.exports = {
  parseExcelToBlocks,
  parseDayRows,
  resolveAttendanceDay,
  saveAttendanceDay,
};
