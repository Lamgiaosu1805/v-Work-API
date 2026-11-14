import {
  accessLevel,
  canActAsHandler,
  canViewSecrets,
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

describe("canViewSecrets (nội dung ẩn)", () => {
  const AUTHOR = "author";
  const t = ticket();

  it("xem được: người gõ, người tạo ticket, người xử lý chính", () => {
    expect(canViewSecrets(t, actor("author"), AUTHOR)).toBe(true);
    expect(canViewSecrets(t, actor("requester"), AUTHOR)).toBe(true);
    expect(canViewSecrets(t, actor("handler"), AUTHOR)).toBe(true);
  });

  it("xem được: người được @ trong chính tin nhắn chứa nội dung ẩn", () => {
    expect(canViewSecrets(t, actor("tagged"), AUTHOR, ["tagged"])).toBe(true);
    expect(canViewSecrets(t, actor("tagged"), AUTHOR, ["other", "tagged", "x"])).toBe(true);
    // Mã ở dạng khác kiểu (ObjectId vs chuỗi) vẫn so khớp
    expect(
      canViewSecrets(t, actor("507f1f77bcf86cd799439011"), AUTHOR, [
        { toString: () => "507f1f77bcf86cd799439011" }
      ])
    ).toBe(true);
  });

  it("KHÔNG xem được: không ở trong danh sách @ của tin đó", () => {
    expect(canViewSecrets(t, actor("tagged"), AUTHOR, ["someoneElse"])).toBe(false);
    expect(canViewSecrets(t, actor("tagged"), AUTHOR, [])).toBe(false);
    expect(canViewSecrets(t, actor("tagged"), AUTHOR)).toBe(false);
    // Danh sách @ của tin khác không đưa vào thì không có hiệu lực (nội dung ẩn ở ô ghi chú không có @)
    expect(canViewSecrets(t, actor("tagged"), AUTHOR, undefined)).toBe(false);
  });

  it("KHÔNG xem được: người phối hợp, quyền nhạy cảm / quản lý / xem hạn chế / xem mọi ticket", () => {
    expect(canViewSecrets(t, actor("collab"), AUTHOR)).toBe(false);
    expect(canViewSecrets(t, actor("it", { canViewSensitive: true }), AUTHOR)).toBe(false);
    expect(canViewSecrets(t, actor("boss", { canManage: true }), AUTHOR)).toBe(false);
    expect(
      canViewSecrets(t, actor("lead", { canViewRestricted: true, canViewAll: true }), AUTHOR)
    ).toBe(false);
    expect(canViewSecrets(t, actor("stranger"), AUTHOR)).toBe(false);
  });

  it("không phụ thuộc trạng thái: ticket đã đóng / huỷ vẫn xem được theo cùng quy tắc", () => {
    ["closed", "cancelled", "resolved", "waiting_info", "on_hold"].forEach((status) => {
      const finished = ticket({ status });
      expect(canViewSecrets(finished, actor("requester"), AUTHOR)).toBe(true);
      expect(canViewSecrets(finished, actor("handler"), AUTHOR)).toBe(true);
      expect(canViewSecrets(finished, actor("tagged"), AUTHOR, ["tagged"])).toBe(true);
      expect(canViewSecrets(finished, actor("it", { canViewSensitive: true }), AUTHOR)).toBe(false);
    });
  });

  it("chưa có chủ trì: chỉ còn người gõ, người tạo và người được @; người được giao đích danh chưa nhận thì không", () => {
    const unclaimed = ticket({
      assignment: {
        mode: "members",
        departmentId: null,
        memberIds: ["handler", "collab"],
        assignedBy: null,
        ownerId: null,
        collaboratorIds: [],
        claimedAt: null
      }
    });
    expect(canViewSecrets(unclaimed, actor("requester"), AUTHOR)).toBe(true);
    expect(canViewSecrets(unclaimed, actor("author"), AUTHOR)).toBe(true);
    expect(canViewSecrets(unclaimed, actor("handler"), AUTHOR)).toBe(false);
    expect(canViewSecrets(unclaimed, actor("collab"), AUTHOR)).toBe(false);
  });

  it("người gõ ẩn danh (không rõ tác giả) không làm lộ cho ai: authorId rỗng thì chỉ người tạo / chủ trì / được @", () => {
    expect(canViewSecrets(t, actor("stranger"), null)).toBe(false);
    expect(canViewSecrets(t, actor("stranger"), undefined)).toBe(false);
    expect(canViewSecrets(t, actor("requester"), null)).toBe(true);
  });
});
