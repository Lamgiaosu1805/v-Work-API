import { ClientSession } from "mongoose";
import { resolveAttendanceDay, ResolveAttendanceDayInput } from "../domain/resolve-attendance-day";
import { persistAttendanceDay } from "./persist-attendance-day";

export interface ProcessAttendanceDayInput extends ResolveAttendanceDayInput {
  userId: string;
  worksheetId: string;
  session?: ClientSession;
}

export interface ProcessAttendanceDayResult {
  skip: boolean;
  // unchanged/leaveRefundAmount chỉ có ý nghĩa khi skip=false — giữ optional thay vì ép giá trị giả
  // (0/false) để caller không nhầm "không đổi" với "không áp dụng".
  unchanged?: boolean;
  leaveRefundAmount?: number;
}

// Use-case duy nhất module expose ra ngoài cho luồng tính+ghi kết quả 1 ngày công — gộp domain
// `resolveAttendanceDay` (tính toán thuần) + application `persistAttendanceDay` (ghi qua repository)
// thành 1 lời gọi, để caller không cần biết ranh giới domain/application nội bộ của module. Giữ đúng
// pattern caller hiện tại đang dùng (gọi resolve rồi kiểm tra skip trước khi persist), chỉ chuyển vào
// trong module thay vì để caller tự làm 2 bước.
export async function processAttendanceDay({
  userId,
  worksheetId,
  session,
  ...resolveInput
}: ProcessAttendanceDayInput): Promise<ProcessAttendanceDayResult> {
  const computed = resolveAttendanceDay(resolveInput);
  if (computed.skip) return { skip: true };

  const persistResult = await persistAttendanceDay({
    userId,
    worksheetId,
    dateKey: resolveInput.dateKey,
    computed,
    session
  });

  return {
    skip: false,
    unchanged: computed.unchanged,
    leaveRefundAmount: persistResult.leaveRefundAmount
  };
}
