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
  TicketStatusChangedDomainEvent,
  TicketUrgencyRaisedDomainEvent
} from "../domain/events/ticket.domain-events";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { loadTicketSettings } from "../infrastructure/ticket-settings";
import { planNotifications } from "./ticket-notification.policy";
import { resolveResponsibleIds } from "./ticket-responsible";

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
  TicketStatusChangedDomainEvent,
  TicketUrgencyRaisedDomainEvent
];

let registered = false;

// Tối đa số người được báo khi giao cho một phòng chưa có người quản lý
const MAX_DEPARTMENT_RECIPIENTS = 200;

async function handle(event: DomainEvent): Promise<void> {
  const tickets = new TicketRepository();
  const ticket = await tickets.findOneById(event.aggregateId);
  if (!ticket) return;
  const props = ticket.getProps();

  const directory = new MongooseTicketDirectory();
  let responsibleIds: string[] = [];
  let departmentManagerId: string | null = null;
  let departmentMemberIds: string[] = [];
  let assignmentTargetLabel = "";

  const needsResponsible =
    event instanceof TicketCreatedDomainEvent ||
    event instanceof TicketUrgencyRaisedDomainEvent ||
    (event instanceof TicketInfoSubmittedDomainEvent && !props.assignment.ownerId);
  if (needsResponsible) {
    // Người phụ trách: cộng dồn mẫu + loại yêu cầu + sản phẩm; ticket Khẩn và Cao thêm cả danh sách mặc định.
    const config = new MongooseTicketConfigReader();
    const [template, category, product, settings] = await Promise.all([
      props.templateId ? config.findTemplate(props.templateId) : null,
      config.findCategory(props.categoryId),
      config.findProduct(props.productId),
      loadTicketSettings()
    ]);
    responsibleIds = resolveResponsibleIds(props.urgency, {
      templateIds: template?.handlerIds,
      categoryIds: category?.handlerIds,
      productIds: product?.handlerIds,
      defaultIds: settings.defaultHandlerIds
    });
  }
  if (event instanceof TicketAssignedDomainEvent) {
    if (event.mode === "department" && event.departmentId) {
      const [department] = await directory.getDepartments([event.departmentId]);
      departmentManagerId = department?.managerId ?? null;
      assignmentTargetLabel = department?.name ?? "";
      // Phòng chưa có người quản lý và ticket chưa ai nhận → báo cả phòng (có trần để không báo tràn lan)
      if (!departmentManagerId && !props.assignment.ownerId) {
        departmentMemberIds = (await directory.getDepartmentMemberIds(event.departmentId)).slice(
          0,
          MAX_DEPARTMENT_RECIPIENTS
        );
      }
    } else if (event.mode === "members") {
      const people = await directory.getEmployees(event.memberIds);
      const names = people.map((person) => person.fullName);
      assignmentTargetLabel =
        names.length > 3
          ? `${names.slice(0, 3).join(", ")} và ${names.length - 3} người khác`
          : names.join(", ");
    }
  }

  const planned = planNotifications(event, {
    ticket: { id: ticket.id, props },
    responsibleIds,
    departmentManagerId,
    departmentMemberIds,
    assignmentTargetLabel
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
