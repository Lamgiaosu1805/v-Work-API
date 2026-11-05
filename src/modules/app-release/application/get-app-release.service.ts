import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { AppRelease, isAppPlatform, updateStatusOf, UpdateStatus } from "../domain/app-version";
import { findAppRelease } from "../infrastructure/app-release.repository";

export interface AppReleaseCheck extends AppRelease {
  currentVersion: string | null;
  updateStatus: UpdateStatus;
}

export async function getAppRelease(platform: unknown, currentVersion?: string | null): Promise<AppReleaseCheck> {
  if (!isAppPlatform(platform)) throw new ArgumentInvalidException("platform phải là ios hoặc android");
  const release = await findAppRelease(platform);
  return {
    ...release,
    currentVersion: currentVersion ?? null,
    updateStatus: updateStatusOf(release, currentVersion)
  };
}
