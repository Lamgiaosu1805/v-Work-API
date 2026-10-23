import TicketCounterModel from "../../../models/TicketCounterModel";
import { toVnDateKey } from "../../../shared-kernel/working-calendar";

// Mã ticket TK-YYMM-NNNN theo tháng (giờ VN). Bộ đếm tăng nguyên tử và KHÔNG nằm trong transaction tạo
// ticket — nhờ vậy nhiều người tạo ticket cùng lúc không phải xếp hàng chờ nhau; ticket tạo lỗi sẽ để
// lại một số trống, chấp nhận được.
export async function nextTicketCode(now: Date = new Date()): Promise<string> {
  const dateKey = toVnDateKey(now); // YYYY-MM-DD
  const period = `${dateKey.slice(2, 4)}${dateKey.slice(5, 7)}`;
  const counter = (await TicketCounterModel.findOneAndUpdate(
    { period },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean()) as { seq: number };
  return `TK-${period}-${String(counter.seq).padStart(4, "0")}`;
}
