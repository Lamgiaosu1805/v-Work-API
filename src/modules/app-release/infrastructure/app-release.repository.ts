import AppReleaseModel from "../../../models/AppReleaseModel";
import {
  AppPlatform,
  AppRelease,
  DEFAULT_STORE_URLS,
  DEFAULT_UPDATE_MESSAGE
} from "../domain/app-version";

function toRelease(platform: AppPlatform, doc: any): AppRelease {
  return {
    platform,
    minVersion: doc?.min_version ?? null,
    latestVersion: doc?.latest_version ?? null,
    storeUrl: doc?.store_url || DEFAULT_STORE_URLS[platform],
    message: doc?.message || DEFAULT_UPDATE_MESSAGE
  };
}

// Middleware chặn bản cũ đọc cấu hình ở MỌI request từ app → giữ trong bộ nhớ, tối đa 60s mới đọc lại DB.
// Admin cập nhật thì xoá cache ngay (instance khác tự cập nhật sau ≤60s).
const CACHE_MS = 60_000;
const cache = new Map<AppPlatform, { release: AppRelease; at: number }>();

export async function findAppRelease(platform: AppPlatform): Promise<AppRelease> {
  const hit = cache.get(platform);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.release;
  const doc = await AppReleaseModel.findOne({ platform, isDeleted: false }).lean();
  const release = toRelease(platform, doc);
  cache.set(platform, { release, at: Date.now() });
  return release;
}

export interface AppReleasePatch {
  minVersion?: string | null;
  latestVersion?: string | null;
  storeUrl?: string | null;
  message?: string | null;
}

export async function saveAppRelease(
  platform: AppPlatform,
  patch: AppReleasePatch,
  updatedBy: string | null
): Promise<AppRelease> {
  const set: Record<string, unknown> = { updated_by: updatedBy };
  if (patch.minVersion !== undefined) set.min_version = patch.minVersion;
  if (patch.latestVersion !== undefined) set.latest_version = patch.latestVersion;
  if (patch.storeUrl !== undefined) set.store_url = patch.storeUrl;
  if (patch.message !== undefined) set.message = patch.message;

  const doc = await AppReleaseModel.findOneAndUpdate(
    { platform },
    { $set: set, $setOnInsert: { platform } },
    { new: true, upsert: true }
  ).lean();
  cache.delete(platform);
  return toRelease(platform, doc);
}
