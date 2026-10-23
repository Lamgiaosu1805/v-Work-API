import UserInfoModel from "../../../models/UserInfoModel";
import { logger } from "../../../config/logger";
import { TicketNotification, TicketNotifier } from "../application/ports";

// Gửi thông báo qua services/notificationService (lưu DB + socket + push FCM). Đường dẫn mở khi bấm
// thông báo là màn ticket của Workplace trên web.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationService = require("../../../services/notificationService");

export const TICKET_NOTIFICATION_TYPE = "ticket";

export function ticketUri(ticketId: string): string {
  return `/workplace/tickets/${ticketId}`;
}

export class NotificationServiceTicketNotifier implements TicketNotifier {
  // eslint-disable-next-line class-methods-use-this
  async notify({ employeeIds, title, body = "", type, ticketId, push = true }: TicketNotification) {
    const uniqueIds = [...new Set(employeeIds.map(String))];
    if (!uniqueIds.length) return;

    const accounts = (await UserInfoModel.find({ _id: { $in: uniqueIds }, isDeleted: false })
      .select("id_account")
      .lean()) as unknown as Array<{ id_account: unknown }>;

    // Mỗi người một thông báo; lỗi gửi cho 1 người không làm hỏng việc gửi cho người khác.
    await Promise.all(
      accounts.map(async ({ id_account: accountId }) => {
        try {
          await notificationService.createNotification({
            account_id: accountId,
            title,
            body,
            type: `${TICKET_NOTIFICATION_TYPE}.${type}`,
            ref_id: ticketId,
            ref_type: "ticket",
            uri: ticketUri(ticketId),
            push
          });
        } catch (error) {
          logger.error("Không gửi được thông báo ticket", { error, ticketId, type });
        }
      })
    );
  }
}
