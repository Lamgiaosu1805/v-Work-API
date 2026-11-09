import { Request, Response } from "express";
import { getAppRelease } from "../application/get-app-release.service";
import { notifyAppUpdate } from "../application/notify-app-update.service";
import { updateAppRelease } from "../application/update-app-release.service";

export const appReleaseHttpController = {
  // Public (app gọi ở Splash, trước khi đăng nhập): GET /app-release?platform=ios&version=1.1.1
  async get(req: Request, res: Response) {
    const version = typeof req.query.version === "string" ? req.query.version : null;
    const data = await getAppRelease(req.query.platform, version);
    return res.status(200).json({ data });
  },

  // Admin: PUT /app-release { minVersion?, latestVersion?, message?, platform?, storeUrl? } — bỏ trống platform =
  // cập nhật cả iOS lẫn Android
  async update(req: Request, res: Response) {
    const accountId = (req as any).account?._id ? String((req as any).account._id) : null;
    const data = await updateAppRelease(req.body ?? {}, accountId);
    return res.status(200).json({ message: "Đã cập nhật cấu hình phiên bản", data });
  },

  // Admin: POST /app-release/notify { body, title?, platform?, version? } — bắn thông báo tự viết khi vừa phát
  // hành bản mới lên store. Bỏ trống platform = gửi cả iOS lẫn Android.
  async notify(req: Request, res: Response) {
    const data = await notifyAppUpdate(req.body ?? {});
    return res.status(200).json({
      message: `Đã gửi thông báo cập nhật tới ${data.successCount}/${data.deviceCount} thiết bị`,
      data
    });
  }
};
