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
    canViewAll: false,
    colleagueIds: [],
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
  it("ticket thường: người xử lý / quản lý (canViewAll) xem đầy đủ mọi ticket", () => {
    const handler = actor("anyone", { canViewAll: true });
    expect(accessLevel(ticket({ visibility: "normal" }), handler)).toBe("full");
  });

  it("ticket thường: nhân viên thường chỉ thấy ticket của mình và người cùng phòng", () => {
    const normal = ticket({ visibility: "normal" });
    expect(accessLevel(normal, actor("stranger"))).toBe("none");
    expect(accessLevel(normal, actor("requester"))).toBe("full");
    expect(
      accessLevel(normal, actor("colleague", { colleagueIds: ["requester", "colleague"] }))
    ).toBe("full");
    // được giao / phối hợp thì thấy dù khác phòng
    expect(accessLevel(normal, actor("collab"))).toBe("full");
    // đồng nghiệp của người KHÁC thì không thấy
    expect(accessLevel(normal, actor("other", { colleagueIds: ["someone-else"] }))).toBe("none");
  });

  it("ticket thường đã đóng: người cùng phòng vẫn xem được (không bị thu về thông tin chung)", () => {
    const closed = ticket({ visibility: "normal", status: "closed" });
    const colleague = actor("colleague", { colleagueIds: ["requester"] });
    expect(accessLevel(closed, colleague)).toBe("full");
  });

  it("ticket hạn chế: người cùng phòng KHÔNG thấy (chỉ người liên quan)", () => {
    const colleague = actor("colleague", { colleagueIds: ["requester"] });
    expect(accessLevel(ticket(), colleague)).toBe("none");
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
