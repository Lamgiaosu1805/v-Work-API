import TicketModel from "../../../models/TicketModel";
import { computeSchedule } from "../domain/ticket-schedule";
import { TICKET_ACTIVE_STATUSES } from "../domain/types";
import { ticketMapper } from "../infrastructure/ticket.mapper";
import { TicketScheduler } from "./ticket-scheduling";

// Mốc cảnh báo vàng / tự đóng / nhắc của ticket được tính SẴN và lưu theo cấu hình lúc ticket thay đổi lần cuối
// (refreshSchedule). Khi quản trị đổi Cài đặt chung (ngưỡng, số ngày tự đóng, lịch làm việc) thì ticket đang mở
// phải được tính lại ngay, nếu không chúng cứ theo số cũ cho tới thao tác kế tiếp.
//
// Chỉ ghi 4 trường mốc, KHÔNG tăng `version`: người đang mở hộp thoại thao tác không bị báo xung đột vì một lần đổi
// cấu hình. Điều kiện ghi kèm `version` đã đọc — ticket vừa được người dùng thao tác (và tự tính lại mốc theo cấu
// hình mới nhất lúc đó) thì bỏ qua, không đè.

const BATCH_SIZE = 200;

const sameDate = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

// Trả về số ticket đã đổi mốc.
export async function refreshActiveTicketSchedules(scheduler: TicketScheduler): Promise<number> {
  let changed = 0;
  let lastId: unknown = null;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const docs = (await TicketModel.find({
      isDeleted: false,
      status: { $in: TICKET_ACTIVE_STATUSES },
      ...(lastId ? { _id: { $gt: lastId } } : {})
    })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean()) as Array<Record<string, any>>;
    if (!docs.length) break;
    lastId = docs[docs.length - 1]._id;

    const writes = docs.flatMap((doc) => {
      const props = ticketMapper.toDomain(doc).getProps();
      const next = computeSchedule(props, scheduler.policy, scheduler.calendar);
      const unchanged =
        sameDate(props.alertAt, next.alertAt) &&
        props.alertReason === next.alertReason &&
        sameDate(props.autoCloseAt, next.autoCloseAt) &&
        sameDate(props.remindAt, next.remindAt);
      if (unchanged) return [];
      return [
        {
          updateOne: {
            filter: { _id: doc._id, isDeleted: false, version: doc.version },
            update: {
              $set: {
                alert_at: next.alertAt,
                alert_reason: next.alertReason,
                auto_close_at: next.autoCloseAt,
                remind_at: next.remindAt
              }
            }
          }
        }
      ];
    });

    if (writes.length) {
      // eslint-disable-next-line no-await-in-loop
      const result = await TicketModel.bulkWrite(writes, { ordered: false });
      changed += result.modifiedCount;
    }
    if (docs.length < BATCH_SIZE) break;
  }
  return changed;
}
