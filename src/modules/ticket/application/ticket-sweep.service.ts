import TicketModel from "../../../models/TicketModel";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import { logger } from "../../../config/logger";
import { URGENCY_LABELS } from "../domain/ticket-catalog";
import { computeReopenUntil } from "../domain/ticket-schedule";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketVersionConflictError } from "../domain/ticket.errors";
import { TICKET_ESCALATED_URGENCIES } from "../domain/types";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { TicketActivityRepository } from "../infrastructure/ticket-activity.repository";
import { MongooseSchedulerLoader } from "../infrastructure/ticket-scheduler.loader";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { TicketDirectory, TicketNotifier } from "./ports";
import { recipientsWithTicketAccess } from "./ticket-recipient-access";
import { refreshSchedule, SchedulerLoader } from "./ticket-scheduling";
import {
  loadResponsibleIds,
  registerTicketNotificationHandlers
} from "./ticket-notification.handlers";

// Việc chạy nền của ticket (cron mỗi vài phút): tự đóng ticket quá hạn, nhắc 1 lần, và nhắc người phụ trách khi
// ticket KHẨN / CAO chưa ai nhận đã bị bôi vàng. Cảnh báo vàng nói chung vẫn chỉ là mốc `alert_at` được so với
// giờ hiện tại khi đọc (không thông báo) — ngoại lệ duy nhất là ticket Khẩn / Cao chưa ai nhận.
// Mỗi ticket xử lý độc lập; trùng version (người dùng vừa thao tác) thì bỏ qua, lần quét sau làm lại.

const BATCH_SIZE = 200;

export interface TicketSweepDeps {
  tickets: TicketRepository;
  activities: TicketActivityRepository;
  scheduler: SchedulerLoader;
  notifier: TicketNotifier;
  directory: TicketDirectory;
  now: () => Date;
}

export interface TicketSweepResult {
  autoClosed: number;
  reminded: number;
  // Số ticket Khẩn / Cao chưa ai nhận đã nhắc người phụ trách
  unclaimedAlerted: number;
  skipped: number;
}

export class TicketSweepService {
  constructor(
    private readonly deps: TicketSweepDeps = {
      tickets: new TicketRepository(),
      activities: new TicketActivityRepository(),
      scheduler: new MongooseSchedulerLoader(),
      notifier: new NotificationServiceTicketNotifier(),
      directory: new MongooseTicketDirectory(),
      now: () => new Date()
    }
  ) {
    registerTicketNotificationHandlers();
  }

  async run(): Promise<TicketSweepResult> {
    const result: TicketSweepResult = {
      autoClosed: 0,
      reminded: 0,
      unclaimedAlerted: 0,
      skipped: 0
    };
    const now = this.deps.now();
    const scheduler = await this.deps.scheduler.load(now);

    // 1. Tự đóng: resolved không xác nhận / waiting_info không bổ sung
    const dueToClose = await TicketModel.find({
      isDeleted: false,
      status: { $in: ["resolved", "waiting_info"] },
      auto_close_at: { $lte: now }
    })
      .select("_id")
      .limit(BATCH_SIZE)
      .lean();

    for (const { _id } of dueToClose as Array<{ _id: unknown }>) {
      const outcome = await this.process(
        String(_id),
        (ticket) => {
          // Đọc lại ticket nên kiểm tra lại: nếu giữa lúc lấy danh sách và lúc xử lý ticket đã rời rồi vào lại
          // trạng thái chờ, mốc tự đóng mới chưa tới thì không đóng sớm.
          const { status, autoCloseAt } = ticket.getProps();
          if (!["resolved", "waiting_info"].includes(status)) return false;
          if (!autoCloseAt || autoCloseAt.getTime() > now.getTime()) return false;
          ticket.autoClose(computeReopenUntil(now, scheduler.policy, scheduler.calendar), now);
          return true;
        },
        scheduler
      );
      if (outcome === "done") result.autoClosed += 1;
      else result.skipped += 1;
    }

    // 2. Nhắc 1 lần: sắp tự đóng (waiting_info) / tới ngày kiểm tra "cần theo dõi thêm" (resolved)
    const dueToRemind = await TicketModel.find({
      isDeleted: false,
      status: { $in: ["resolved", "waiting_info"] },
      remind_at: { $lte: now }
    })
      .select("_id")
      .limit(BATCH_SIZE)
      .lean();

    for (const { _id } of dueToRemind as Array<{ _id: unknown }>) {
      const outcome = await this.remind(String(_id), now);
      if (outcome === "done") result.reminded += 1;
      else result.skipped += 1;
    }

    // 3. Ticket Khẩn / Cao chưa ai nhận đã vàng → nhắc người phụ trách đúng 1 lần cho mỗi mốc `alert_at`
    const dueUnclaimed = await TicketModel.find({
      isDeleted: false,
      status: "open",
      urgency: { $in: TICKET_ESCALATED_URGENCIES },
      alert_reason: "unclaimed",
      alert_at: { $lte: now },
      // Chỉ ticket có trường này (tạo sau khi có tính năng nhắc, mặc định null): ticket cũ đã vàng từ trước không bị báo
      // dồn ở lần quét đầu tiên sau khi triển khai.
      alert_notified_for: { $exists: true },
      $expr: { $ne: ["$alert_notified_for", "$alert_at"] }
    })
      .select("_id")
      .limit(BATCH_SIZE)
      .lean();

    for (const { _id } of dueUnclaimed as Array<{ _id: unknown }>) {
      const outcome = await this.alertUnclaimed(String(_id), now);
      if (outcome === "done") result.unclaimedAlerted += 1;
      else result.skipped += 1;
    }

    return result;
  }

  private async alertUnclaimed(ticketId: string, now: Date): Promise<"done" | "skipped"> {
    try {
      const ticket = await this.deps.tickets.findOneById(ticketId);
      if (!ticket) return "skipped";
      const props = ticket.getProps();
      // Đọc lại ticket nên kiểm tra lại: đã có người nhận / đổi mức / chưa tới mốc thì không nhắc.
      if (props.status !== "open" || props.assignment.ownerId) return "skipped";
      if (!TICKET_ESCALATED_URGENCIES.includes(props.urgency)) return "skipped";
      if (!props.alertAt || props.alertReason !== "unclaimed") return "skipped";
      if (props.alertAt.getTime() > now.getTime()) return "skipped";

      // Đánh dấu "đã nhắc cho mốc này" TRƯỚC khi gửi bằng lệnh có điều kiện: hai lần quét chồng nhau chỉ một bên
      // giành được. Không đụng `version` — chỉ cron ghi trường này nên không làm người dùng bị xung đột.
      const claimed = await TicketModel.updateOne(
        {
          _id: ticket.id,
          status: "open",
          alert_at: props.alertAt,
          isDeleted: false,
          $expr: { $ne: ["$alert_notified_for", "$alert_at"] }
        },
        { $set: { alert_notified_for: props.alertAt } }
      );
      if (!claimed.modifiedCount) return "skipped";

      try {
        const responsibleIds = await loadResponsibleIds(props);
        const allowed = await recipientsWithTicketAccess(
          this.deps.directory,
          props,
          responsibleIds
        );
        await this.deps.notifier.notify({
          strict: true,
          employeeIds: responsibleIds.filter((id) => id !== props.createdBy && allowed.has(id)),
          title: `Ticket ${URGENCY_LABELS[props.urgency]} chưa ai nhận`,
          body: `${props.code} · ${props.title}
Ticket đã chờ quá ngưỡng cảnh báo mà chưa có người nhận xử lý.`,
          type: "unclaimed_alert",
          ticketId: ticket.id
        });
      } catch (error) {
        // Gửi lỗi: bỏ đánh dấu để lần quét sau thử lại
        await TicketModel.updateOne({ _id: ticket.id }, { $set: { alert_notified_for: null } });
        throw error;
      }
      return "done";
    } catch (error) {
      logger.warn("Không nhắc được ticket chưa ai nhận", { error, ticketId });
      return "skipped";
    }
  }

  private async process(
    ticketId: string,
    // Trả về false = không còn cần xử lý (bỏ qua, không ghi)
    mutate: (ticket: TicketEntity) => boolean,
    scheduler: Awaited<ReturnType<SchedulerLoader["load"]>>
  ): Promise<"done" | "skipped"> {
    try {
      const ticket = await this.deps.tickets.findOneById(ticketId);
      if (!ticket) return "skipped";
      if (!mutate(ticket)) return "skipped";
      refreshSchedule(ticket, scheduler);
      const activities = ticket.pullActivities();
      await runInTransaction(async () => {
        await this.deps.tickets.save(ticket);
        await this.deps.activities.append(ticket.id, activities);
      });
      ticket.publishEvents(eventBus).catch((error) => {
        logger.error("Lỗi khi xử lý sự kiện ticket", { error, ticketId });
      });
      return "done";
    } catch (error) {
      // Ticket vừa bị người dùng sửa / không còn ở trạng thái tự đóng: bỏ qua, lần quét sau xét lại.
      if (!(error instanceof TicketVersionConflictError)) {
        logger.warn("Bỏ qua ticket khi quét tự đóng", { error, ticketId });
      }
      return "skipped";
    }
  }

  private async remind(ticketId: string, now: Date): Promise<"done" | "skipped"> {
    try {
      const ticket = await this.deps.tickets.findOneById(ticketId);
      if (!ticket) return "skipped";
      const props = ticket.getProps();
      // Đọc lại ticket nên kiểm tra lại: đã đổi trạng thái / chưa tới mốc nhắc thì không nhắc.
      if (!["resolved", "waiting_info"].includes(props.status)) return "skipped";
      if (!props.remindAt || props.remindAt.getTime() > now.getTime()) return "skipped";

      // Đánh dấu "đã nhắc" TRƯỚC khi gửi, bằng một lệnh có điều kiện (còn đúng trạng thái + mốc nhắc) và tăng
      // version: hai lần quét chồng nhau chỉ một bên giành được; người dùng vừa ghi dựa trên bản cũ sẽ gặp
      // xung đột version (và tự thử lại) thay vì ghi đè mất dấu "đã nhắc".
      const claimed = await TicketModel.updateOne(
        { _id: ticket.id, status: props.status, remind_at: props.remindAt, isDeleted: false },
        { $set: { reminder_sent_at: now, remind_at: null }, $inc: { version: 1 } }
      );
      if (!claimed.modifiedCount) return "skipped";

      try {
        await this.sendReminder(ticket, props);
      } catch (error) {
        // Gửi lỗi: trả mốc nhắc về như cũ để lần quét sau thử lại
        await TicketModel.updateOne(
          { _id: ticket.id },
          { $set: { reminder_sent_at: null, remind_at: props.remindAt }, $inc: { version: 1 } }
        );
        throw error;
      }
      return "done";
    } catch (error) {
      logger.warn("Không nhắc được ticket", { error, ticketId });
      return "skipped";
    }
  }

  private async sendReminder(ticket: TicketEntity, props: ReturnType<TicketEntity["getProps"]>) {
    if (props.status === "waiting_info") {
      await this.deps.notifier.notify({
        employeeIds: [props.createdBy],
        title: "Ticket sắp tự đóng nếu không bổ sung",
        body: `${props.code} · ${props.title}\nVui lòng bổ sung thông tin còn thiếu.`,
        type: "auto_close_reminder",
        ticketId: ticket.id
      });
      return;
    }
    await this.deps.notifier.notify({
      // Chủ trì nhận thay cả nhóm; ticket không còn chủ trì thì báo người phối hợp còn lại.
      employeeIds: props.assignment.ownerId ? [props.assignment.ownerId] : ticket.handlerIds,
      title: "Đến ngày kiểm tra ticket cần theo dõi",
      body: `${props.code} · ${props.title}\n${props.followUp?.note ?? ""}`,
      type: "follow_up_reminder",
      ticketId: ticket.id
    });
  }
}
