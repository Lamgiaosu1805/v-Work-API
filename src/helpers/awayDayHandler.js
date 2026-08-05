const moment = require("moment-timezone");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const ShiftModel = require("../models/ShiftModel");
const { applyLeaveConflictOverride } = require("../modules/timesheet");
const { adjustLeaveBalance } = require("../modules/leave");
const { LEAVE_BALANCE_REASON } = require("../constants");

const TZ = "Asia/Ho_Chi_Minh";

function buildTimeOnDate(dateMoment, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return dateMoment.clone().hour(h).minute(m).second(0).millisecond(0).toDate();
}
function createOnApprove(status) {
  return async function onApprove(request, session) {
    const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
    const toMoment = moment.tz(request.to_date, TZ).startOf("day");
    const fromStart = fromMoment.toDate();
    const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();

    const workDates = [];
    const cursor = fromMoment.clone();
    while (cursor.isSameOrBefore(toMoment, "day")) {
      if (cursor.day() !== 0) workDates.push(cursor.clone());
      cursor.add(1, "day");
    }
    if (!workDates.length) return;

    const [adminShift, morningShift] = await Promise.all([
      ShiftModel.findOne({ name: "Ca hành chính" }).session(session),
      ShiftModel.findOne({ name: "Ca sáng" }).session(session)
    ]);

    const existing = await WorkSheetModel.find({
      user_id: request.user_id,
      date: { $gte: fromStart, $lte: toEnd },
      isDeleted: false
    })
      .populate("shifts")
      .session(session);
    const sheetMap = new Map(existing.map((w) => [moment.tz(w.date, TZ).format("YYYY-MM-DD"), w]));

    for (const dateMoment of workDates) {
      const dateKey = dateMoment.format("YYYY-MM-DD");
      const isSaturday = dateMoment.day() === 6;
      let worksheet = sheetMap.get(dateKey);

      if (!worksheet) {
        const defaultShift = isSaturday ? morningShift : adminShift;
        const [created] = await WorkSheetModel.create(
          [
            {
              user_id: request.user_id,
              date: dateMoment.toDate(),
              shifts: defaultShift ? [defaultShift._id] : []
            }
          ],
          { session }
        );
        worksheet = await created.populate("shifts");
        sheetMap.set(dateKey, worksheet);
      }

      let startTime = "08:00";
      let endTime = isSaturday ? "12:00" : "17:00";
      if (worksheet.shifts?.length > 0) {
        startTime = worksheet.shifts[0].start_time;
        endTime = worksheet.shifts[worksheet.shifts.length - 1].end_time;
      }

      const check_in = buildTimeOnDate(dateMoment, startTime);
      const check_out = buildTimeOnDate(dateMoment, endTime);
      const work_unit = isSaturday ? 0.5 : 1;

      await WorkSheetModel.updateOne(
        { _id: worksheet._id },
        {
          check_in,
          check_out,
          work_unit,
          minutes_late: 0,
          minute_early: 0,
          penalty_amount: 0
        },
        { session }
      );

      const { leaveRefundAmount } = await applyLeaveConflictOverride({
        userId: request.user_id.toString(),
        worksheetId: worksheet._id.toString(),
        dateKey,
        checkInTime: check_in,
        checkOutTime: check_out,
        lastShiftEnd: endTime,
        session
      });
      if (leaveRefundAmount > 0) {
        await adjustLeaveBalance({
          userId: request.user_id,
          amount: leaveRefundAmount,
          reason: LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND,
          refId: worksheet._id,
          refType: "system",
          allowNegative: true,
          session
        });
      }

      await WorkDayStatusModel.findOneAndUpdate(
        { user_id: request.user_id, date: dateMoment.toDate(), period: "full" },
        {
          worksheet_id: worksheet._id,
          status,
          $addToSet: { sources: { ref_id: request._id, ref_type: "request" } }
        },
        { upsert: true, session, new: true }
      );
    }
  };
}

module.exports = { createOnApprove };
