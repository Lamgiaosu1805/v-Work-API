import { ClientSession, Types } from "mongoose";
import AllowedWifiLocationModel from "../../../models/AllowedWifiLocationModel";
import { RequestContextService } from "../../../core/context/request-context";

// Trả nguyên field gốc (`_id` là ObjectId, không remap `id: string`) — khác convention của
// WorkSheetRepository, vì các endpoint CRUD wifi hiện trả THẲNG document này ra HTTP response cho
// frontend (đã dùng `_id` từ trước, Express tự serialize ObjectId->hex string qua JSON.stringify) —
// giữ nguyên hành vi, không đổi contract API khi cutover.
export interface AllowedWifiLocationRecord {
  _id: Types.ObjectId;
  name: string;
  ssid: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface CreateAllowedWifiLocationInput {
  name?: string;
  ssid: string;
  latitude: number;
  longitude: number;
  radius?: number;
}

export class AllowedWifiLocationRepository {
  // eslint-disable-next-line class-methods-use-this
  private resolveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? (RequestContextService.getTransactionSession() as ClientSession | undefined);
  }

  async findActive(session?: ClientSession): Promise<AllowedWifiLocationRecord[]> {
    return AllowedWifiLocationModel.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .session(this.resolveSession(session) ?? null)
      .lean();
  }

  async findBySsid(
    ssid: string,
    session?: ClientSession
  ): Promise<AllowedWifiLocationRecord | null> {
    return AllowedWifiLocationModel.findOne({ ssid, isDeleted: false })
      .session(this.resolveSession(session) ?? null)
      .lean();
  }

  async create(
    input: CreateAllowedWifiLocationInput,
    session?: ClientSession
  ): Promise<AllowedWifiLocationRecord> {
    const payload: Record<string, unknown> = {
      name: input.name ?? "",
      ssid: input.ssid,
      latitude: input.latitude,
      longitude: input.longitude
    };
    if (input.radius != null) payload.radius = input.radius;

    const [doc] = await AllowedWifiLocationModel.create([payload], {
      session: this.resolveSession(session)
    });
    return doc.toObject();
  }

  async softDelete(id: string, session?: ClientSession): Promise<AllowedWifiLocationRecord | null> {
    return AllowedWifiLocationModel.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { new: true, session: this.resolveSession(session) }
    ).lean();
  }
}
