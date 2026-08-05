import { ShiftRepository, ShiftRecord } from "../infrastructure/shift.repository";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

const shiftRepository = new ShiftRepository();

// Port nguyên AttendanceController.getAllShifts/createShift (task 1.8.4.9) — CRUD mỏng bọc
// ShiftRepository (1.8.4.4).

export async function listShifts(): Promise<ShiftRecord[]> {
  return shiftRepository.findAll();
}

export interface CreateShiftServiceInput {
  name?: string;
  start_time?: string;
  end_time?: string;
  late_allowance_minutes?: number;
}

// Lỗi validate/trùng tên đều ArgumentInvalidException (400) — khớp nguyên vẹn hành vi gốc (bản gốc trả
// 400 cho cả 2 nhánh, không có 409). `late_allowance_minutes` mặc định 0 (không phải default 5 của
// Mongoose schema) — giữ nguyên hành vi gốc đã ghi chú ở ShiftRepository.create.
export async function createShift({
  name,
  start_time,
  end_time,
  late_allowance_minutes = 0
}: CreateShiftServiceInput): Promise<ShiftRecord> {
  if (!name || !start_time || !end_time) {
    throw new ArgumentInvalidException("name, start_time, end_time là bắt buộc");
  }

  const existing = await shiftRepository.findByName(name);
  if (existing) throw new ArgumentInvalidException(`Shift ${name} đã tồn tại`);

  return shiftRepository.create({ name, start_time, end_time, late_allowance_minutes });
}
