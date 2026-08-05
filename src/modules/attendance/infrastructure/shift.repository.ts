import { ClientSession, Types } from "mongoose";
import ShiftModel from "../../../models/ShiftModel";
import { RequestContextService } from "../../../core/context/request-context";

// Trả nguyên field gốc (`_id` là ObjectId) — endpoint CRUD shift hiện trả THẲNG document ra HTTP
// response, giữ nguyên hành vi khi cutover (giống lý do ở AllowedWifiLocationRepository).
export interface ShiftRecord {
  _id: Types.ObjectId;
  name: string;
  start_time: string;
  end_time: string;
  late_allowance_minutes: number;
}

export interface CreateShiftInput {
  name: string;
  start_time: string;
  end_time: string;
  late_allowance_minutes?: number;
}

export class ShiftRepository {
  // eslint-disable-next-line class-methods-use-this
  private resolveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? (RequestContextService.getTransactionSession() as ClientSession | undefined);
  }

  // Giữ nguyên hành vi gốc: `ShiftModel.find()` KHÔNG lọc `isDeleted` (getAllShifts hiện tại cũng
  // vậy) — không tự thêm filter mới coi như "sửa đúng", vì hiện chưa có route xoá shift nào cả.
  async findAll(session?: ClientSession): Promise<ShiftRecord[]> {
    return ShiftModel.find()
      .session(this.resolveSession(session) ?? null)
      .lean();
  }

  async findByName(name: string, session?: ClientSession): Promise<ShiftRecord | null> {
    return ShiftModel.findOne({ name })
      .session(this.resolveSession(session) ?? null)
      .lean();
  }

  async create(input: CreateShiftInput, session?: ClientSession): Promise<ShiftRecord> {
    const [doc] = await ShiftModel.create(
      [
        {
          name: input.name,
          start_time: input.start_time,
          end_time: input.end_time,
          late_allowance_minutes: input.late_allowance_minutes ?? 0
        }
      ],
      { session: this.resolveSession(session) }
    );
    return doc.toObject();
  }
}
