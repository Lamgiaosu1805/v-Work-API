import {
  accessLevel,
  canActAsHandler,
  canViewSensitiveFiles
} from "../../../src/modules/ticket/domain/ticket-access";
import { TicketActor } from "../../../src/modules/ticket/domain/types";

function actor(employeeId: string, overrides: Partial<TicketActor> = {}): TicketActor {
  return {
    employeeId,
    departmentIds: [],
    canAssignDepartment: false,
    canAssignMember: false,
    canManage: false,
    canViewRestricted: false,
    canViewSensitive: false,
    ...overrides
  };
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress" as const,
    visibility: "restricted" as const,
    createdBy: "requester",
    assignment: {
      mode: "members" as const,
      departmentId: null,
      memberIds: ["handler", "collab"],
      assignedBy: null,
      ownerId: "handler",
      collaboratorIds: ["collab"],
      claimedAt: null
    },
    ...overrides
  };
}

describe("accessLevel", () => {
  it("ticket thường: mọi nhân viên xem đầy đủ", () => {
    expect(accessLevel(ticket({ visibility: "normal" }), actor("anyone"))).toBe("full");
  });

  it("ticket hạn chế: người ngoài không thấy", () => {
    expect(accessLevel(ticket(), actor("stranger"))).toBe("none");
  });

  it("ticket hạn chế: người tạo, chủ trì, phối hợp, người được giao đích danh xem được khi chưa đóng", () => {
    ["requester", "handler", "collab"].forEach((id) => {
      expect(accessLevel(ticket(), actor(id))).toBe("full");
    });
    const unclaimed = ticket({
      assignment: { ...ticket().assignment, ownerId: null, collaboratorIds: [] }
    });
    expect(accessLevel(unclaimed, actor("collab"))).toBe("full");
  });

  it("ticket hạn chế: người có quyền xem luôn xem được, kể cả sau khi đóng", () => {
    const viewer = actor("boss", { canViewRestricted: true });
    expect(accessLevel(ticket({ status: "closed" }), viewer)).toBe("full");
  });

  it("ticket hạn chế đã đóng: người tạo và nhóm xử lý chỉ còn thông tin chung", () => {
    expect(accessLevel(ticket({ status: "closed" }), actor("requester"))).toBe("summary");
    expect(accessLevel(ticket({ status: "closed" }), actor("handler"))).toBe("summary");
    expect(accessLevel(ticket({ status: "cancelled" }), actor("requester"))).toBe("summary");
    expect(accessLevel(ticket({ status: "closed" }), actor("stranger"))).toBe("none");
  });
});

describe("canViewSensitiveFiles", () => {
  it("người có quyền xem file nhạy cảm luôn xem được", () => {
    expect(
      canViewSensitiveFiles(ticket({ status: "closed" }), actor("it", { canViewSensitive: true }))
    ).toBe(true);
  });

  it("người liên quan xem được khi ticket chưa đóng, mất quyền sau khi đóng", () => {
    expect(canViewSensitiveFiles(ticket(), actor("requester"))).toBe(true);
    expect(canViewSensitiveFiles(ticket(), actor("collab"))).toBe(true);
    expect(canViewSensitiveFiles(ticket({ status: "closed" }), actor("requester"))).toBe(false);
  });

  it("ticket thường nhưng file nhạy cảm (vd CCCD): người ngoài vẫn không mở được", () => {
    expect(canViewSensitiveFiles(ticket({ visibility: "normal" }), actor("stranger"))).toBe(false);
  });
});

describe("canActAsHandler", () => {
  it("chủ trì, người phối hợp và người có ticket.manage được thao tác như nhóm xử lý", () => {
    expect(canActAsHandler(ticket(), actor("handler"))).toBe(true);
    expect(canActAsHandler(ticket(), actor("collab"))).toBe(true);
    expect(canActAsHandler(ticket(), actor("boss", { canManage: true }))).toBe(true);
    expect(canActAsHandler(ticket(), actor("requester"))).toBe(false);
    expect(canActAsHandler(ticket(), actor("stranger"))).toBe(false);
  });
});
