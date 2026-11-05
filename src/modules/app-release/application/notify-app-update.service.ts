import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { APP_PLATFORMS, AppPlatform, isAppPlatform, isValidVersion } from "../domain/app-version";
import { findAppRelease } from "../infrastructure/app-release.repository";
import { broadcastAppUpdate, BroadcastResult } from "../infrastructure/app-update-broadcaster";

const DEFAULT_TITLE = "Đã có phiên bản vWork mới";

export interface NotifyAppUpdateInput {
  title?: unknown;
  body?: unknown;
  platform?: unknown;
  version?: unknown;
}

export interface NotifyAppUpdateResult {
  title: string;
  body: string;
  platforms: Array<BroadcastResult & { platform: AppPlatform }>;
  deviceCount: number;
  successCount: number;
}

// Bắn 1 thông báo do admin tự viết tới máy iOS và / hoặc Android. Mỗi nền tảng kèm link store của nó trong data
// để app bản mới bấm vào là mở store; `version` (tuỳ chọn) để app đang mở bỏ qua nếu máy đã ở bản đó.
export async function notifyAppUpdate(input: NotifyAppUpdateInput): Promise<NotifyAppUpdateResult> {
  const body = String(input.body ?? "").trim();
  if (!body) throw new ArgumentInvalidException("Thiếu nội dung thông báo (body)");
  const title = String(input.title ?? "").trim() || DEFAULT_TITLE;

  if (input.platform !== undefined && input.platform !== null && !isAppPlatform(input.platform)) {
    throw new ArgumentInvalidException("platform phải là ios hoặc android (bỏ trống = cả hai)");
  }
  if (input.version !== undefined && input.version !== null && !isValidVersion(input.version)) {
    throw new ArgumentInvalidException("version phải có dạng 1.2.3");
  }
  const platforms = isAppPlatform(input.platform) ? [input.platform] : APP_PLATFORMS;

  const results = [];
  for (const platform of platforms) {
    const release = await findAppRelease(platform);
    const version = (input.version as string | undefined)?.trim() || release.latestVersion || "";
    const result = await broadcastAppUpdate({
      platform,
      title,
      body,
      data: { type: "app_update", version, storeUrl: release.storeUrl }
    });
    results.push({ ...result, platform });
  }

  return {
    title,
    body,
    platforms: results,
    deviceCount: results.reduce((sum, item) => sum + item.deviceCount, 0),
    successCount: results.reduce((sum, item) => sum + item.successCount, 0)
  };
}
