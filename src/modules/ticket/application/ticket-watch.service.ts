import mongoose from "mongoose";
import { loadEmployeeAbility } from "../../../core/authorization/can-employee";
import { accessLevel } from "../domain/ticket-access";
import { TicketProps } from "../domain/types";
import { TicketRepository } from "../infrastructure/ticket.repository";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { TicketDirectory, TicketWatchAuthorizer } from "./ports";
import { buildTicketActorForEmployee, TICKET_SUBJECT } from "./ticket-actor";

// Quyền xem ticket cho kênh realtime (socket). Dùng ĐÚNG quy tắc của API chi tiết: có quyền ticket.view ở mức module
// (route `GET /tickets/:id`) + quan hệ với từng ticket (domain/ticket-access.ts). Ticket không tồn tại hoặc không xem được
// đều trả "không" như nhau, không lộ sự có mặt của ticket hạn chế.

interface WatchDeps {
  tickets: Pick<TicketRepository, "findOneById">;
  directory: TicketDirectory;
}

type AccessProps = Pick<TicketProps, "status" | "visibility" | "createdBy" | "assignment">;

export class TicketWatchService implements TicketWatchAuthorizer {
  constructor(
    private readonly deps: WatchDeps = {
      tickets: new TicketRepository(),
      directory: new MongooseTicketDirectory()
    }
  ) {}

  async canWatch(employeeId: string, ticketId: string): Promise<boolean> {
    const props = await this.loadProps(ticketId);
    return props ? this.canView(props, employeeId) : false;
  }

  async lostAccess(ticketId: string, employeeIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(employeeIds.map(String))];
    const props = await this.loadProps(ticketId);
    // Ticket đã bị xoá / không còn: ai đang xem cũng mất quyền
    if (!props) return new Set(unique);
    const lost = new Set<string>();
    await Promise.all(
      unique.map(async (employeeId) => {
        if (!(await this.canView(props, employeeId))) lost.add(employeeId);
      })
    );
    return lost;
  }

  private async loadProps(ticketId: string): Promise<AccessProps | null> {
    if (!mongoose.isValidObjectId(ticketId)) return null;
    const ticket = await this.deps.tickets.findOneById(ticketId);
    return ticket ? ticket.getProps() : null;
  }

  private async canView(props: AccessProps, employeeId: string): Promise<boolean> {
    const ability = await loadEmployeeAbility(employeeId);
    if (!ability.can("ticket.view", TICKET_SUBJECT)) return false;
    const actor = await buildTicketActorForEmployee(this.deps.directory, employeeId, ability);
    return accessLevel(props, actor) !== "none";
  }
}
