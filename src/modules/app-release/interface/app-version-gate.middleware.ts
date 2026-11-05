import { NextFunction, Request, Response } from "express";
import { isAppPlatform, updateStatusOf } from "../domain/app-version";
import { findAppRelease } from "../infrastructure/app-release.repository";

// App mobile gửi kèm x-app-platform + x-app-version ở mọi request. Bản thấp hơn min_version → 426, app hiện
// màn bắt buộc cập nhật (kể cả người đang mở app sẵn, không đi qua màn Splash). Web / client không gửi header
// thì bỏ qua. Lỗi đọc cấu hình cũng cho qua — không khoá nhầm người dùng vì sự cố phía server.
export async function appVersionGate(req: Request, res: Response, next: NextFunction) {
  const platform = req.header("x-app-platform");
  const version = req.header("x-app-version");
  if (!platform || !version || !isAppPlatform(platform) || req.path.startsWith("/app-release")) {
    return next();
  }
  try {
    const release = await findAppRelease(platform);
    if (updateStatusOf(release, version) !== "required") return next();
    return res.status(426).json({
      errorCode: "APP_UPDATE_REQUIRED",
      message: release.message,
      data: { ...release, currentVersion: version, updateStatus: "required" }
    });
  } catch {
    return next();
  }
}
