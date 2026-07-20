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
    const nextStart = idx + 1 < headers.length ? headers[idx + 1].startRow : rows.length;
    return {
      machine_code: h.machine_code,
      rows: rows.slice(h.startRow + 1, nextStart)
    };
  });
}

function parseDayRows(block) {
  const dayRows = [];
  for (const row of block.rows) {
    const dateStr = String(row[0] || "").trim();
    if (!DATE_REGEX.test(dateStr)) continue;
    const inCell = [row[2], row[4], row[6]].find((v) => TIME_REGEX.test(String(v).trim()));
    const outCell = [row[7], row[5], row[3]].find((v) => TIME_REGEX.test(String(v).trim()));
    dayRows.push({
      dateStr,
      rawIn: inCell ? String(inCell).trim().slice(0, 5) : null,
      rawOut: outCell ? String(outCell).trim().slice(0, 5) : null
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
  forgotOccurrenceMap,
  lateForgivenSet,
  earlyForgivenSet,
  leavePeriodsMap,
  resolveLatePenalty,
  resolveEarlyPenalty,
  resolveForgotPenalty
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

  const appIn = worksheet.check_in ? new Date(worksheet.check_in) : null;
  const appOut = worksheet.check_out ? new Date(worksheet.check_out) : null;

  let newCheckIn = machineIn && appIn ? new Date(Math.min(machineIn, appIn)) : machineIn || appIn;
  let newCheckOut =
    machineOut && appOut ? new Date(Math.max(machineOut, appOut)) : machineOut || appOut;
  if (forgot) {
    if (forgot.type === "check_in" || forgot.type === "both") newCheckIn = worksheet.check_in;
    if (forgot.type === "check_out" || forgot.type === "both") newCheckOut = worksheet.check_out;
  }

  const MIN_GAP_MINUTES = 120;
  if (newCheckIn && newCheckOut) {
    const gapMinutes = (new Date(newCheckOut) - new Date(newCheckIn)) / 60000;
    if (gapMinutes < MIN_GAP_MINUTES) newCheckOut = null;
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
  let leaveMorning = !!leavePeriods && (leavePeriods.has("morning") || leavePeriods.has("full"));
  let leaveAfternoon =
    !!leavePeriods && (leavePeriods.has("afternoon") || leavePeriods.has("full"));
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
      if (moment.tz(newCheckOut, TZ).isSameOrAfter(threshold)) leaveAfternoon = false;
    }
  }
  const leaveDeduction = Math.min(
    isSaturday ? 0.5 : 1,
    (leaveMorning ? 0.5 : 0) + (leaveAfternoon ? 0.5 : 0)
  );
  const missedIn = !hasIn && !leaveMorning;
  const missedOut = !hasOut && !leaveAfternoon;

  let minutesLate = 0;
  const firstShift = worksheet.shifts && worksheet.shifts[0];
  if (hasIn && !leaveMorning && firstShift && firstShift.start_time) {
    const [sh, sm] = firstShift.start_time.split(":").map(Number);
    const shiftStart = moment.tz(dateKey, TZ).hour(sh).minute(sm).second(0);
    minutesLate = Math.max(0, Math.floor((moment.tz(newCheckIn, TZ) - shiftStart) / 60000));
  }
  if (forgiven) minutesLate = 0;

  let minutesEarly = 0;
  if (hasOut && !leaveAfternoon && lastShiftEnd) {
    const [eh, em] = lastShiftEnd.split(":").map(Number);
    const shiftEnd = moment.tz(dateKey, TZ).hour(eh).minute(em).second(0);
    minutesEarly = Math.max(0, Math.floor((shiftEnd - moment.tz(newCheckOut, TZ)) / 60000));
  }
  const earlyForgiven = earlyForgivenSet.has(dateKey);
  if (earlyForgiven) minutesEarly = 0;

  let work_unit;
  let penalty_amount = 0;
  let morning_absent = false;
  let afternoon_absent = false;
  if (missedIn || missedOut) {
    const occInfo = forgotOccurrenceMap?.get(dateKey);
    if (occInfo && !occInfo.hasRequest) {
      const base = isSaturday ? 0.5 : 1;
      work_unit = Math.max(0, base / 2 - leaveDeduction);
    } else {
      work_unit = 0;
    }
  } else if (forgot) {
    const occInfo = forgotOccurrenceMap?.get(dateKey);
    const occurrence = occInfo?.occurrence || 0;
    const r = resolveForgotPenalty(dayStart, occurrence, isSaturday);
    work_unit = Math.max(0, r.work_unit - leaveDeduction);
    penalty_amount = r.penalty_amount;
  } else {
    const lateResult = resolveLatePenalty(dayStart, minutesLate, isSaturday);
    const earlyResult = resolveEarlyPenalty(dayStart, minutesEarly, isSaturday);
    work_unit = Math.max(0, Math.min(lateResult.work_unit, earlyResult.work_unit) - leaveDeduction);
    penalty_amount = lateResult.penalty_amount + earlyResult.penalty_amount;
    morning_absent = lateResult.morning_absent;
    afternoon_absent = earlyResult.afternoon_absent;
  }

  const sameTime = (a, b) =>
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  const unchanged =
    sameTime(worksheet.check_in, newCheckIn) &&
    sameTime(worksheet.check_out, newCheckOut) &&
    (worksheet.minutes_late ?? 0) === minutesLate &&
    (worksheet.minute_early ?? 0) === minutesEarly &&
    (worksheet.work_unit ?? null) === work_unit &&
    (worksheet.penalty_amount ?? 0) === penalty_amount;
  if (unchanged) return { skip: true, unchanged: true };

  worksheet.check_in = newCheckIn;
  worksheet.check_out = newCheckOut;
  worksheet.minutes_late = minutesLate;
  worksheet.minute_early = minutesEarly;
  worksheet.work_unit = work_unit;
  worksheet.penalty_amount = penalty_amount;

  return {
    skip: false,
    newCheckIn,
    newCheckOut,
    minutesLate,
    minutesEarly,
    work_unit,
    penalty_amount,
    morning_absent,
    afternoon_absent,
    hasIn,
    hasOut,
    missedIn,
    missedOut,
    lastShiftEnd
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
      session
    });

    const OVERRIDABLE = ["pending", "missed_clock", "absent"];

    // Trạng thái từng buổi: nếu bị phạt (absent do đi muộn/về sớm quá mức) thì "absent",
    // nếu chỉ đơn thuần thiếu chấm công (không phạt) thì "missed_clock" (Quên chấm),
    // ngược lại buổi đó có chấm công thật -> "present" (Đi làm).
    const resolvePeriodStatus = (isAbsent, isMissed) => {
      if (isAbsent) return "absent";
      if (isMissed) return "missed_clock";
      return "present";
    };
    const morningStatus = resolvePeriodStatus(computed.morning_absent, computed.missedIn);
    const afternoonStatus = resolvePeriodStatus(computed.afternoon_absent, computed.missedOut);

    if (morningStatus === afternoonStatus) {
      // Cả ngày cùng 1 trạng thái -> giữ 1 doc period "full"
      const newStatus = morningStatus;
      const result = await WorkDayStatusModel.updateMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: OVERRIDABLE },
          isDeleted: false
        },
        { status: newStatus },
        { session }
      );
      if (result.matchedCount === 0) {
        await WorkDayStatusModel.updateOne(
          { user_id: userId, date: dayStart, period: "full" },
          {
            $set: { status: newStatus },
            $setOnInsert: {
              worksheet_id: worksheet._id,
              sources: [{ ref_id: worksheet._id, ref_type: "attendance" }],
              isDeleted: false
            }
          },
          { upsert: true, session }
        );
      }
    } else {
      // Khác trạng thái theo buổi -> tách 2 doc "morning"/"afternoon"
      await WorkDayStatusModel.deleteMany(
        {
          user_id: userId,
          date: { $gte: dayStart, $lt: dayEnd },
          status: { $in: OVERRIDABLE }
        },
        { session }
      );
      const periodStatuses = [
        ["morning", morningStatus],
        ["afternoon", afternoonStatus]
      ];
      for (const [period, st] of periodStatuses) {
        await WorkDayStatusModel.updateOne(
          { user_id: userId, date: dayStart, period },
          {
            $setOnInsert: {
              worksheet_id: worksheet._id,
              status: st,
              sources: [{ ref_id: worksheet._id, ref_type: "attendance" }],
              isDeleted: false
            }
          },
          { upsert: true, session }
        );
      }
    }

    await session.commitTransaction();
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

const NON_DERIVABLE_STATUSES = new Set([
  "leave_paid",
  "leave_unpaid",
  "remote",
  "business_trip",
  "client_visit"
]);

// Đối chiếu day_statuses với check_in/check_out thật của worksheet trước khi trả về client,
// đề phòng status lưu cũ/lệch (vd: checkout đã bị sửa/xoá sau khi status được tính lần trước).
// Đối chiếu theo TỪNG buổi: "morning" ứng với check_in, "afternoon" ứng với check_out,
// "full" ứng với cả 2 (đủ cả 2 mới coi là có dữ liệu).
function correctDayStatuses(statuses, ws) {
  const hasCheckIn = !!ws?.check_in;
  const hasCheckOut = !!ws?.check_out;
  if (!hasCheckIn && !hasCheckOut) return statuses;

  return statuses.map((s) => {
    if (NON_DERIVABLE_STATUSES.has(s.status)) return s;

    let periodHasData;
    if (s.period === "morning") periodHasData = hasCheckIn;
    else if (s.period === "afternoon") periodHasData = hasCheckOut;
    else periodHasData = hasCheckIn && hasCheckOut;

    if (!periodHasData && s.status !== "missed_clock") return { ...s, status: "missed_clock" };
    if (periodHasData && s.status === "absent") return { ...s, status: "present" };
    return s;
  });
}

module.exports = {
  parseExcelToBlocks,
  parseDayRows,
  resolveAttendanceDay,
  saveAttendanceDay,
  correctDayStatuses
};
