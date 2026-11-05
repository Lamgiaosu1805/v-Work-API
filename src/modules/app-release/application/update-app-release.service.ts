import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { AppRelease, compareVersions, isAppPlatform, isValidVersion } from "../domain/app-version";
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

export async function updateAppRelease(
  platform: unknown,
  body: Record<string, unknown>,
  updatedBy: string | null
): Promise<AppRelease> {
  if (!isAppPlatform(platform)) throw new ArgumentInvalidException("platform phải là ios hoặc android");

  const patch: AppReleasePatch = {
    minVersion: normalizeVersion(body.minVersion, "minVersion"),
    latestVersion: normalizeVersion(body.latestVersion, "latestVersion"),
    storeUrl: normalizeText(body.storeUrl),
    message: normalizeText(body.message)
  };
  if (patch.storeUrl && !/^https?:\/\//.test(patch.storeUrl)) {
    throw new ArgumentInvalidException("storeUrl phải là link http(s)");
  }

  const current = await findAppRelease(platform);
  const min = patch.minVersion !== undefined ? patch.minVersion : current.minVersion;
  const latest = patch.latestVersion !== undefined ? patch.latestVersion : current.latestVersion;
  if (min && latest && compareVersions(min, latest) > 0) {
    throw new ArgumentInvalidException("minVersion không được lớn hơn latestVersion");
  }

  return saveAppRelease(platform, patch, updatedBy);
}
