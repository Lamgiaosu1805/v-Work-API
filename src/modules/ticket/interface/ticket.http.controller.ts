import { Request, Response } from "express";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { MongooseTicketDirectory } from "../infrastructure/ticket-directory";
import { AbilityLike, buildTicketActor } from "../application/ticket-actor";
import { getTicketCommandService } from "../application/ticket-commands.service";
import { getTicketConfigService } from "../application/ticket-config.service";
import { getTicketQueryService } from "../application/ticket-queries.service";
import { TicketResolutionCode, TicketUrgency } from "../domain/types";
import {
  contentTypeFor,
  parseListQuery,
  readPayload,
  readUploadedFiles,
  toDate,
  toStringList
} from "./ticket-request-parsers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cleanupUploadedFiles = require("../../../utils/cleanupUploadedFiles");

// Controller mỏng: dựng người thao tác → gọi service → định dạng response. Lỗi domain/application là
// ExceptionBase nên asyncHandler + errorHandlerMiddleware tự trả đúng mã HTTP, không cần try/catch.

const directory = new MongooseTicketDirectory();

async function actorOf(req: Request) {
  const ability = (req as unknown as { permissionAbility?: AbilityLike }).permissionAbility;
  return buildTicketActor(directory, String(req.account?._id), ability);
}

const param = (req: Request, name: string) => String(req.params[name]);

const ok = (res: Response, data: unknown, message?: string) =>
  res.status(200).json(message ? { message, data } : { data });

// Upload xong mà thao tác lỗi thì xoá file đã ghi đĩa để không để file mồ côi.
async function withUploadCleanup<T>(req: Request, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    cleanupUploadedFiles((req as unknown as { files?: unknown }).files, "ticket");
    throw error;
  }
}

const requireText = (value: unknown, message: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ArgumentInvalidException(message);
  return text;
};

const approvalReferenceOf = (payload: Record<string, any>) =>
  payload.approvalReference?.number
    ? {
        number: String(payload.approvalReference.number),
        date: toDate(payload.approvalReference.date, "Ngày tờ trình"),
        signer: String(payload.approvalReference.signer ?? "")
      }
    : null;

export const ticketHttpController = {
  // ---- đọc ----------------------------------------------------------------------------------

  async meta(req: Request, res: Response) {
    return ok(res, await getTicketQueryService().meta(await actorOf(req)));
  },

  async counts(req: Request, res: Response) {
    return ok(res, await getTicketQueryService().counts(await actorOf(req)));
  },

  async list(req: Request, res: Response) {
    const result = await getTicketQueryService().list(
      await actorOf(req),
      parseListQuery(req.query)
    );
    return res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    return ok(res, await getTicketQueryService().getById(await actorOf(req), param(req, "id")));
  },

  async searchTickets(req: Request, res: Response) {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    return ok(res, await getTicketQueryService().searchTickets(await actorOf(req), q));
  },

  async searchEmployees(req: Request, res: Response) {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    return ok(res, await getTicketQueryService().searchEmployees(q, Number(req.query.limit) || 20));
  },

  async listDepartments(_req: Request, res: Response) {
    return ok(res, await getTicketQueryService().listDepartments());
  },

  async downloadAttachment(req: Request, res: Response) {
    const file = await getTicketQueryService().getAttachmentFile(
      await actorOf(req),
      param(req, "id"),
      param(req, "attachmentId")
    );
    const { type, inline } = contentTypeFor(file.originalName);
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
    );
    return res.sendFile(file.filePath);
  },

  // ---- ghi ----------------------------------------------------------------------------------

  async create(req: Request, res: Response) {
    return withUploadCleanup(req, async () => {
      const payload = readPayload(req);
      const files = readUploadedFiles(req, payload);
      const result = await getTicketCommandService().create(
        await actorOf(req),
        {
          title: requireText(payload.title, "Vui lòng nhập tiêu đề ticket"),
          description: payload.description,
          productId: payload.productId,
          categoryId: payload.categoryId,
          templateId: payload.templateId || null,
          customFields: payload.customFields,
          urgency: payload.urgency as TicketUrgency | undefined,
          customer: payload.customer,
          assignment: payload.assignment,
          relatedTicketIds: toStringList(payload.relatedTicketIds),
          approvalReference: approvalReferenceOf(payload)
        },
        files
      );
      return res.status(201).json({ message: "Tạo ticket thành công", data: result });
    });
  },

  async edit(req: Request, res: Response) {
    const { note, ...patch } = readPayload(req);
    const result = await getTicketCommandService().edit(
      await actorOf(req),
      param(req, "id"),
      patch,
      note
    );
    return ok(res, result, "Đã cập nhật ticket");
  },

  async claim(req: Request, res: Response) {
    return ok(
      res,
      await getTicketCommandService().claim(await actorOf(req), param(req, "id")),
      "Bạn đã nhận xử lý ticket"
    );
  },

  async release(req: Request, res: Response) {
    const { note } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().release(await actorOf(req), param(req, "id"), note),
      "Đã trả lại ticket"
    );
  },

  async assign(req: Request, res: Response) {
    const payload = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().assign(await actorOf(req), param(req, "id"), {
        mode: payload.mode,
        departmentId: payload.departmentId,
        memberIds: toStringList(payload.memberIds),
        ownerId: payload.ownerId
      }),
      "Đã giao ticket"
    );
  },

  async addCollaborator(req: Request, res: Response) {
    const { employeeId } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().addCollaborator(
        await actorOf(req),
        param(req, "id"),
        requireText(employeeId, "Vui lòng chọn người phối hợp")
      ),
      "Đã thêm người phối hợp"
    );
  },

  async removeCollaborator(req: Request, res: Response) {
    return ok(
      res,
      await getTicketCommandService().removeCollaborator(
        await actorOf(req),
        param(req, "id"),
        param(req, "employeeId")
      ),
      "Đã bỏ người phối hợp"
    );
  },

  async requestInfo(req: Request, res: Response) {
    const payload = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().requestInfo(await actorOf(req), param(req, "id"), {
        items: Array.isArray(payload.items) ? payload.items : [],
        note: payload.note
      }),
      "Đã yêu cầu người tạo bổ sung"
    );
  },

  async submitInfo(req: Request, res: Response) {
    return withUploadCleanup(req, async () => {
      const payload = readPayload(req);
      return ok(
        res,
        await getTicketCommandService().submitInfo(
          await actorOf(req),
          param(req, "id"),
          { approvalReference: approvalReferenceOf(payload) },
          readUploadedFiles(req, payload)
        ),
        "Đã gửi bổ sung"
      );
    });
  },

  async verifyApproval(req: Request, res: Response) {
    const { valid, note } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().verifyApproval(await actorOf(req), param(req, "id"), {
        valid: valid === true,
        note
      }),
      valid === true ? "Đã xác nhận tờ trình hợp lệ" : "Đã trả tờ trình về người tạo"
    );
  },

  async hold(req: Request, res: Response) {
    const { reason, resumeAt } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().hold(await actorOf(req), param(req, "id"), {
        reason,
        resumeAt: toDate(resumeAt, "Ngày dự kiến tiếp tục")
      }),
      "Đã tạm hoãn ticket"
    );
  },

  async resume(req: Request, res: Response) {
    return ok(
      res,
      await getTicketCommandService().resume(await actorOf(req), param(req, "id")),
      "Đã tiếp tục xử lý"
    );
  },

  async resolve(req: Request, res: Response) {
    const payload = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().resolve(await actorOf(req), param(req, "id"), {
        note: payload.note,
        actionTaken: payload.actionTaken,
        followUp: payload.followUp
          ? {
              note: String(payload.followUp.note ?? ""),
              checkAt: toDate(payload.followUp.checkAt, "Ngày kiểm tra")
            }
          : null
      }),
      "Đã báo xử lý xong, chờ người tạo xác nhận"
    );
  },

  async close(req: Request, res: Response) {
    const payload = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().close(await actorOf(req), param(req, "id"), {
        code: payload.code as TicketResolutionCode,
        note: payload.note,
        actionTaken: payload.actionTaken,
        duplicateOf: payload.duplicateOf
      }),
      "Đã đóng ticket"
    );
  },

  async confirm(req: Request, res: Response) {
    return ok(
      res,
      await getTicketCommandService().confirm(await actorOf(req), param(req, "id")),
      "Đã xác nhận hoàn tất"
    );
  },

  async cancel(req: Request, res: Response) {
    const { note } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().cancel(await actorOf(req), param(req, "id"), note),
      "Đã huỷ ticket"
    );
  },

  async reopen(req: Request, res: Response) {
    const { note } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().reopen(await actorOf(req), param(req, "id"), note),
      "Đã mở lại ticket"
    );
  },

  async setDueHint(req: Request, res: Response) {
    const { dueHintAt, reason } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().setDueHint(await actorOf(req), param(req, "id"), {
        dueHintAt: toDate(dueHintAt, "Ngày dự kiến"),
        reason
      }),
      "Đã cập nhật ngày dự kiến"
    );
  },

  async linkRelated(req: Request, res: Response) {
    const { relatedTicketId } = readPayload(req);
    return ok(
      res,
      await getTicketCommandService().linkRelated(
        await actorOf(req),
        param(req, "id"),
        requireText(relatedTicketId, "Vui lòng chọn ticket liên quan")
      ),
      "Đã liên kết ticket"
    );
  },

  async addMessage(req: Request, res: Response) {
    return withUploadCleanup(req, async () => {
      const payload = readPayload(req);
      const result = await getTicketCommandService().addMessage(
        await actorOf(req),
        param(req, "id"),
        { body: payload.body, mentionIds: toStringList(payload.mentionIds) },
        readUploadedFiles(req, payload)
      );
      return res.status(201).json({ message: "Đã gửi tin nhắn", data: result });
    });
  },

  // ---- cấu hình (quyền ticket.config) -------------------------------------------------------

  async configList(req: Request, res: Response) {
    return ok(res, await getTicketConfigService().list(param(req, "kind")));
  },

  async configCreate(req: Request, res: Response) {
    const created = await getTicketConfigService().create(param(req, "kind"), readPayload(req));
    return res.status(201).json({ message: "Đã tạo", data: created });
  },

  async configUpdate(req: Request, res: Response) {
    return ok(
      res,
      await getTicketConfigService().update(param(req, "kind"), param(req, "id"), readPayload(req)),
      "Đã cập nhật"
    );
  },

  async configRemove(req: Request, res: Response) {
    await getTicketConfigService().remove(param(req, "kind"), param(req, "id"));
    return res.status(200).json({ message: "Đã xoá" });
  },

  async settingsGet(_req: Request, res: Response) {
    return ok(res, await getTicketConfigService().getSettings());
  },

  async settingsUpdate(req: Request, res: Response) {
    return ok(
      res,
      await getTicketConfigService().updateSettings(readPayload(req)),
      "Đã lưu cài đặt"
    );
  }
};
