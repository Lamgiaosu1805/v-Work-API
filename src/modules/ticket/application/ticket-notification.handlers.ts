import { logger } from "../../../config/logger";
import { DomainEvent } from "../../../core/ddd/domain-event.base";
import { eventBus } from "../../../core/events/event-bus";
import {
  TicketApprovalVerifiedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketContentEditedDomainEvent,
  TicketCreatedDomainEvent,
  TicketInfoRequestedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketStatusChangedDomainEvent
} from "../domain/events/ticket.domain-events";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { loadTicketSettings } from "../infrastructure/ticket-settings";
import { planNotifications } from "./ticket-notification.policy";

// Lắng nghe domain event của ticket và gửi thông báo theo ticket-notification.policy.ts. Mọi lỗi được
// log, KHÔNG ném ra ngoài — thông báo hỏng không được làm hỏng thao tác của người dùng.

const EVENTS = [
  TicketCreatedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketInfoRequestedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketContentEditedDomainEvent,
  TicketApprovalVerifiedDomainEvent,
  TicketStatusChangedDomainEvent
];

let registered = false;

async function handle(event: DomainEvent): Promise<void> {
  const tickets = new TicketRepository();
  const ticket = await tickets.findOneById(event.aggregateId);
  if (!ticket) return;
  const props = ticket.getProps();

  const directory = new MongooseTicketDirectory();
  let urgentHandlerIds: string[] = [];
  let departmentManagerId: string | null = null;

  if (event instanceof TicketCreatedDomainEvent && event.urgency === "urgent") {
    // Người phụ trách: mẫu → loại yêu cầu → mặc định (dùng cấp đầu tiên có cấu hình).
    const config = new MongooseTicketConfigReader();
    const [template, category, settings] = await Promise.all([
      props.templateId ? config.findTemplate(props.templateId) : null,
      config.findCategory(props.categoryId),
      loadTicketSettings()
    ]);
    urgentHandlerIds =
      [template?.handlerIds, category?.handlerIds, settings.defaultHandlerIds].find(
        (ids) => ids && ids.length
      ) ?? [];
  }
  if (
    event instanceof TicketAssignedDomainEvent &&
    event.mode === "department" &&
    event.departmentId
  ) {
    const [department] = await directory.getDepartments([event.departmentId]);
    departmentManagerId = department?.managerId ?? null;
  }

  const planned = planNotifications(event, {
    ticket: { id: ticket.id, props },
    urgentHandlerIds,
    departmentManagerId
  });
  const notifier = new NotificationServiceTicketNotifier();
  await Promise.all(
    planned.map((item) =>
      notifier.notify({
        employeeIds: item.employeeIds,
        title: item.title,
        body: item.body,
        type: item.type,
        ticketId: ticket.id
      })
    )
  );
}

// Idempotent: gọi nhiều lần (mỗi service/test tạo mới) vẫn chỉ đăng ký một lần.
export function registerTicketNotificationHandlers(): void {
  if (registered) return;
  registered = true;
  EVENTS.forEach((eventClass) => {
    eventBus.on(eventClass.name, (event: DomainEvent) =>
      handle(event).catch((error) =>
        logger.error("Không gửi được thông báo ticket", { error, event: eventClass.name })
      )
    );
  });
}
