import { AllowedWifiLocationRepository } from "../infrastructure/allowed-wifi-location.repository";
import { isWithinRadius } from "../domain/geofence";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

const allowedWifiLocationRepository = new AllowedWifiLocationRepository();

export interface CheckWifiLocationInput {
  ssid?: string;
  latitude?: number;
  longitude?: number;
}

// Tách từ record-check-in.service.ts/record-check-out.service.ts (task 1.8.5.1) — logic validate
// SSID+geofence lặp y hệt ở cả 2 luồng, giờ 2 workflow (record-check-in/out.workflow.ts) dùng chung
// thay vì copy-paste 2 lần. Message/thứ tự lỗi giữ nguyên hành vi gốc (cả 2 đều ArgumentInvalidException
// 400, khớp bản gốc trước migrate).
export async function checkWifiLocation({
  ssid,
  latitude,
  longitude
}: CheckWifiLocationInput): Promise<void> {
  if (!ssid || latitude == null || longitude == null) {
    throw new ArgumentInvalidException("ssid, latitude, longitude required");
  }

  const allowed = await allowedWifiLocationRepository.findBySsid(ssid);
  if (!allowed) throw new ArgumentInvalidException("SSID không hợp lệ.");

  const withinRadius = isWithinRadius(
    { latitude, longitude },
    { latitude: allowed.latitude, longitude: allowed.longitude },
    allowed.radius
  );
  if (!withinRadius) throw new ArgumentInvalidException("Vị trí không hợp lệ.");
}
