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
import { TicketProps } from "../domain/types";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { MongooseTicketConfigReader } from "../infrastructure/ticket-config.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { NotificationServiceTicketNotifier } from "../infrastructure/ticket-notifier";
import { loadTicketSettings } from "../infrastructure/ticket-settings";
import { planNotifications } from "./ticket-notification.policy";
import { recipientsWithTicketAccess } from "./ticket-recipient-access";
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

// Loại thông báo vẫn gửi cho người không còn mở được ticket (báo họ đã bị gỡ khỏi nhóm xử lý).
const SKIP_ACCESS_FILTER = new Set(["unassigned"]);

// Người phụ trách của ticket: cộng dồn mẫu + loại yêu cầu + sản phẩm; ticket Khẩn và Cao thêm cả danh sách
// mặc định (cài đặt chung). Dùng cho thông báo ticket mới và nhắc ticket Khẩn/Cao chưa ai nhận (cron).
export async function loadResponsibleIds(
  props: Pick<TicketProps, "templateId" | "categoryId" | "productId" | "urgency">
): Promise<string[]> {
  const config = new MongooseTicketConfigReader();
  const [template, category, product, settings] = await Promise.all([
    props.templateId ? config.findTemplate(props.templateId) : null,
    config.findCategory(props.categoryId),
    config.findProduct(props.productId),
    loadTicketSettings()
  ]);
  return resolveResponsibleIds(props.urgency, {
    templateIds: template?.handlerIds,
    categoryIds: category?.handlerIds,
    productIds: product?.handlerIds,
    defaultIds: settings.defaultHandlerIds
  });
}

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
    (event instanceof TicketInfoSubmittedDomainEvent && !props.assignment.ownerId) ||
    (event instanceof TicketStatusChangedDomainEvent && event.to === "open");
  if (needsResponsible) {
    responsibleIds = await loadResponsibleIds(props);
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

  // Huỷ ticket / quay về hàng chờ cần biết trưởng phòng đang được giao (ticket giao cho phòng chưa có chủ trì)
  if (
    event instanceof TicketStatusChangedDomainEvent &&
    (event.to === "cancelled" || event.to === "open") &&
    props.assignment.mode === "department" &&
    props.assignment.departmentId
  ) {
    const [department] = await directory.getDepartments([props.assignment.departmentId]);
    departmentManagerId = department?.managerId ?? null;
  }

  const allPlanned = planNotifications(event, {
    ticket: { id: ticket.id, props },
    responsibleIds,
    departmentManagerId,
    departmentMemberIds,
    assignmentTargetLabel
  });
  // Chỉ báo người thật sự mở được ticket (không gửi link chết / lộ tiêu đề cho người ngoài quyền xem)
  const allowed = await recipientsWithTicketAccess(
    directory,
    props,
    allPlanned
      .filter((item) => !SKIP_ACCESS_FILTER.has(item.type))
      .flatMap((item) => item.employeeIds),
    [departmentManagerId, ...departmentMemberIds]
  );
  const planned = allPlanned
    .map((item) => ({
      ...item,
      employeeIds: SKIP_ACCESS_FILTER.has(item.type)
        ? item.employeeIds
        : item.employeeIds.filter((id) => allowed.has(id))
    }))
    .filter((item) => item.employeeIds.length > 0);
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
