import {
  AllowedWifiLocationRepository,
  AllowedWifiLocationRecord
} from "../infrastructure/allowed-wifi-location.repository";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";

const allowedWifiLocationRepository = new AllowedWifiLocationRepository();

// Port nguyên AttendanceController.getAllowedWifiLocations/createAllowedWifiLocation/
// deleteAllowedWifiLocation (task 1.8.4.9) — CRUD mỏng bọc AllowedWifiLocationRepository (1.8.4.3).

export async function listAllowedWifiLocations(): Promise<AllowedWifiLocationRecord[]> {
  return allowedWifiLocationRepository.findActive();
}

export interface CreateAllowedWifiLocationServiceInput {
  name?: string;
  ssid?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
}

// Lỗi validate/trùng SSID đều ArgumentInvalidException (400) — khớp nguyên vẹn hành vi gốc (bản gốc
// trả 400 cho cả 2 nhánh, không có 409). "Không tìm thấy" khi xoá dùng NotFoundException (404) — TRÙNG
// khớp status code gốc (đã là 404 từ trước), không phải nâng cấp ngữ nghĩa.
export async function createAllowedWifiLocation({
  name = "",
  ssid,
  latitude,
  longitude,
  radius
}: CreateAllowedWifiLocationServiceInput): Promise<AllowedWifiLocationRecord> {
  if (!ssid || latitude == null || longitude == null) {
    throw new ArgumentInvalidException("ssid, latitude, longitude là bắt buộc");
  }

  const existing = await allowedWifiLocationRepository.findBySsid(ssid);
  if (existing) throw new ArgumentInvalidException(`SSID "${ssid}" đã tồn tại`);

  return allowedWifiLocationRepository.create({ name, ssid, latitude, longitude, radius });
}

export async function deleteAllowedWifiLocation(id: string): Promise<void> {
  const doc = await allowedWifiLocationRepository.softDelete(id);
  if (!doc) throw new NotFoundException("Không tìm thấy điểm chấm công");
}
