import TicketModel from "../../../models/TicketModel";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import { logger } from "../../../config/logger";
import { computeReopenUntil } from "../domain/ticket-schedule";
import { TicketEntity } from "../domain/ticket.entity";
import { TicketVersionConflictError } from "../domain/ticket.errors";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { TicketActivityRepository } from "../infrastructure/ticket-activity.repository";
import { MongooseSchedulerLoader } from "../infrastructure/ticket-scheduler.loader";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { TicketDirectory, TicketNotifier } from "./ports";
import { refreshSchedule, SchedulerLoader } from "./ticket-scheduling";
import { registerTicketNotificationHandlers } from "./ticket-notification.handlers";

// Việc chạy nền của ticket (cron mỗi vài phút): tự đóng ticket quá hạn và nhắc 1 lần. KHÔNG có việc
// "gửi cảnh báo vàng" — vàng chỉ là mốc `alert_at` được so với giờ hiện tại khi đọc (không thông báo).
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
    const result: TicketSweepResult = { autoClosed: 0, reminded: 0, skipped: 0 };
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
          ticket.autoClose(computeReopenUntil(now, scheduler.policy, scheduler.calendar), now);
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

    return result;
  }

  private async process(
    ticketId: string,
    mutate: (ticket: TicketEntity) => void,
    scheduler: Awaited<ReturnType<SchedulerLoader["load"]>>
  ): Promise<"done" | "skipped"> {
    try {
      const ticket = await this.deps.tickets.findOneById(ticketId);
      if (!ticket) return "skipped";
      mutate(ticket);
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

      if (props.status === "waiting_info") {
        await this.deps.notifier.notify({
          employeeIds: [props.createdBy],
          title: "Ticket sắp tự đóng nếu không bổ sung",
          body: `${props.code} · ${props.title}\nVui lòng bổ sung thông tin còn thiếu.`,
          type: "auto_close_reminder",
          ticketId: ticket.id
        });
      } else {
        await this.deps.notifier.notify({
          employeeIds: ticket.handlerIds,
          title: "Đến ngày kiểm tra ticket cần theo dõi",
          body: `${props.code} · ${props.title}\n${props.followUp?.note ?? ""}`,
          type: "follow_up_reminder",
          ticketId: ticket.id
        });
      }

      ticket.markReminded(now);
      // Ghi trực tiếp, không qua version: chỉ đổi 2 trường nhắc, tránh tranh chấp với người dùng.
      await TicketModel.updateOne(
        { _id: ticket.id, status: props.status },
        { $set: { reminder_sent_at: now, remind_at: null } }
      );
      return "done";
    } catch (error) {
      logger.warn("Không nhắc được ticket", { error, ticketId });
      return "skipped";
    }
  }
}
