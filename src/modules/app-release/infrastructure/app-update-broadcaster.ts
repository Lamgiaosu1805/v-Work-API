import DeviceTokenModel from "../../../models/DeviceTokenModel";
import getFirebaseAdmin from "../../../config/firebase";
import { deactivateInvalidTokens } from "../../../helpers/pushNotification";
import { AppPlatform } from "../domain/app-version";

// FCM sendEachForMulticast nhận tối đa 500 token / lần
const BATCH_SIZE = 500;

export interface BroadcastInput {
  platform: AppPlatform;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface BroadcastResult {
  deviceCount: number;
  successCount: number;
  failureCount: number;
  invalidCount: number;
}

// Gửi tới MỌI thiết bị đang hoạt động của nền tảng (không lọc theo tài khoản / phiên bản: device token không lưu
// version app nên không biết máy nào đã cập nhật). Token hỏng được tắt luôn như sendToAccount.
export async function broadcastAppUpdate(input: BroadcastInput): Promise<BroadcastResult> {
  const rows = (await DeviceTokenModel.find({ platform: input.platform, is_active: true, isDeleted: false })
    .select("fcm_token")
    .lean()) as Array<{ fcm_token: string }>;
  const tokens = [...new Set(rows.map((row) => row.fcm_token).filter(Boolean))];
  const result: BroadcastResult = { deviceCount: tokens.length, successCount: 0, failureCount: 0, invalidCount: 0 };
  if (!tokens.length) return result;

  const messaging = getFirebaseAdmin().messaging();
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const response = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title: input.title, body: input.body },
      data: { ...input.data, timestamp: new Date().toISOString() },
      android: { priority: "high", notification: { sound: "default", channelId: "default" } },
      apns: { payload: { aps: { sound: "default" } } }
    });
    result.successCount += response.successCount;
    result.failureCount += response.failureCount;
    const invalid = await deactivateInvalidTokens(batch, response.responses);
    result.invalidCount += invalid.length;
  }
  return result;
}
