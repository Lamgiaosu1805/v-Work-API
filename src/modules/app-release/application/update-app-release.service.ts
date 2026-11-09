import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import {
  APP_PLATFORMS,
  AppRelease,
  compareVersions,
  isAppPlatform,
  isValidVersion
} from "../domain/app-version";
import { AppReleasePatch, findAppRelease, saveAppRelease } from "../infrastructure/app-release.repository";

function normalizeVersion(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isValidVersion(value)) throw new ArgumentInvalidException(`${field} phải có dạng 1.2.3`);
  return value.trim();
}

function normalizeText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim() || null;
}

// Phát hành iOS + Android cùng lúc → 1 lần gọi cập nhật cả 2 nền tảng. Truyền `platform` khi chỉ muốn đổi 1 bên
// (bắt buộc khi đổi storeUrl vì mỗi nền tảng một link store). Kiểm tra hết các nền tảng trước rồi mới lưu, để
// không có chuyện lưu được iOS nhưng Android lỗi.
export async function updateAppRelease(
  body: Record<string, unknown>,
  updatedBy: string | null
): Promise<AppRelease[]> {
  if (body.platform !== undefined && body.platform !== null && !isAppPlatform(body.platform)) {
    throw new ArgumentInvalidException("platform phải là ios hoặc android (bỏ trống = cả hai)");
  }
  const platforms = isAppPlatform(body.platform) ? [body.platform] : APP_PLATFORMS;

  const patch: AppReleasePatch = {
    minVersion: normalizeVersion(body.minVersion, "minVersion"),
    latestVersion: normalizeVersion(body.latestVersion, "latestVersion"),
    storeUrl: normalizeText(body.storeUrl),
    message: normalizeText(body.message)
  };
  if (patch.storeUrl !== undefined && platforms.length > 1) {
    throw new ArgumentInvalidException("Đổi storeUrl phải truyền platform (mỗi nền tảng một link store)");
  }
  if (patch.storeUrl && !/^https?:\/\//.test(patch.storeUrl)) {
    throw new ArgumentInvalidException("storeUrl phải là link http(s)");
  }
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new ArgumentInvalidException("Không có thông tin nào để cập nhật");
  }

  for (const platform of platforms) {
    const current = await findAppRelease(platform);
    const min = patch.minVersion !== undefined ? patch.minVersion : current.minVersion;
    const latest = patch.latestVersion !== undefined ? patch.latestVersion : current.latestVersion;
    if (min && latest && compareVersions(min, latest) > 0) {
      throw new ArgumentInvalidException(`minVersion không được lớn hơn latestVersion (${platform})`);
    }
  }

  const saved: AppRelease[] = [];
  for (const platform of platforms) {
    saved.push(await saveAppRelease(platform, patch, updatedBy));
  }
  return saved;
}
