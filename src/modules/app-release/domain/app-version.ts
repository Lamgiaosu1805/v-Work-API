export type AppPlatform = "ios" | "android";

export const APP_PLATFORMS: AppPlatform[] = ["ios", "android"];

export const DEFAULT_STORE_URLS: Record<AppPlatform, string> = {
  ios: "https://apps.apple.com/app/id6764513061",
  android: "https://play.google.com/store/apps/details?id=com.vnfitevwork"
};

export const DEFAULT_UPDATE_MESSAGE =
  "Đã có phiên bản vWork mới. Vui lòng cập nhật để tiếp tục sử dụng.";

const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;

export function isAppPlatform(value: unknown): value is AppPlatform {
  return value === "ios" || value === "android";
}

export function isValidVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value.trim());
}

// So sánh "1.2.10" với "1.2.9" theo từng phần số (không so chuỗi). Thiếu phần coi là 0: "1.2" == "1.2.0".
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export interface AppRelease {
  platform: AppPlatform;
  minVersion: string | null;
  latestVersion: string | null;
  storeUrl: string;
  message: string;
}

export type UpdateStatus = "required" | "optional" | "none";

// Không có min/latest (chưa cấu hình) hoặc version không đọc được → không chặn ai
export function updateStatusOf(release: AppRelease, currentVersion: string | null | undefined): UpdateStatus {
  if (!isValidVersion(currentVersion)) return "none";
  if (release.minVersion && compareVersions(currentVersion, release.minVersion) < 0) return "required";
  if (release.latestVersion && compareVersions(currentVersion, release.latestVersion) < 0) return "optional";
  return "none";
}
