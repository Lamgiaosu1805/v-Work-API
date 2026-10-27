import {
  TicketApprovalVerifiedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketCreatedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketStatusChangedDomainEvent,
  TicketUrgencyRaisedDomainEvent
} from "../../../src/modules/ticket/domain/events/ticket.domain-events";
import {
  MessageNotificationContext,
  planMessageNotifications,
  planNotifications,
  PolicyContext
} from "../../../src/modules/ticket/application/ticket-notification.policy";
import {
  sortCategories,
  sortProducts,
  sortTemplates
} from "../../../src/modules/ticket/infrastructure/ticket-config.repository";
import { resolveResponsibleIds } from "../../../src/modules/ticket/application/ticket-responsible";
import {
  buildListFilter,
  tabFilter,
  visibilityFilter
} from "../../../src/modules/ticket/application/ticket-query-filters";
import { capabilitiesOf } from "../../../src/modules/ticket/domain/ticket-capabilities";
import {
  contentTypeFor,
  parseListQuery,
  readPayload
} from "../../../src/modules/ticket/interface/ticket-request-parsers";
import { TicketActor } from "../../../src/modules/ticket/domain/types";

const ME = "emp-me";
const REQUESTER = "emp-requester";
const OWNER = "emp-owner";
const BOSS = "emp-boss";

function actor(overrides: Partial<TicketActor> = {}): TicketActor {
  return {
    employeeId: ME,
    departmentIds: ["dept-1"],
    canAssignDepartment: false,
    canAssignMember: false,
    canManage: false,
    canViewRestricted: false,
    canViewSensitive: false,
    ...overrides
  };
}

function context(
  overrides: Partial<PolicyContext["ticket"]["props"]> = {},
  rest: Partial<PolicyContext> = {}
): PolicyContext {
  return {
    ticket: {
      id: "t1",
      props: {
        code: "TK-2610-0001",
        title: "Khách không nhận OTP",
        createdBy: REQUESTER,
        status: "in_progress",
        infoRequest: null,
        assignment: {
          mode: "none",
          departmentId: null,
          memberIds: [],
          assignedBy: null,
          ownerId: OWNER,
          collaboratorIds: [],
          claimedAt: null
        },
        ...overrides
      }
    },
    responsibleIds: ["handler-1", "handler-2"],
    departmentManagerId: "dept-manager",
    ...rest
  };
}

const recipients = (planned: ReturnType<typeof planNotifications>) =>
  planned.flatMap((item) => item.employeeIds);

describe("planNotifications — chỉ báo đúng người cần", () => {
  it("ticket mới → người phụ trách (mọi mức khẩn đều báo); không có người phụ trách thì không báo ai", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "urgent"
    });
    expect(recipients(planNotifications(urgent, context()))).toEqual(["handler-1", "handler-2"]);

    const normal = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "normal"
    });
    const normalPlan = planNotifications(normal, context());
    expect(recipients(normalPlan)).toEqual(["handler-1", "handler-2"]);
    expect(normalPlan[0].type).toBe("created");
    expect(planNotifications(urgent, context({}, { responsibleIds: [] }))).toEqual([]);
    expect(planNotifications(normal, context({}, { responsibleIds: [] }))).toEqual([]);
  });

  it("ticket mức Khẩn và Cao báo với tiêu đề riêng của từng mức", () => {
    const planFor = (urgency: "urgent" | "high") =>
      planNotifications(
        new TicketCreatedDomainEvent({ aggregateId: "t1", actorId: REQUESTER, urgency }),
        context()
      )[0];
    expect(planFor("urgent")).toMatchObject({
      type: "urgent_created",
      title: "Ticket mức Khẩn mới"
    });
    expect(planFor("high")).toMatchObject({ type: "high_created", title: "Ticket mức Cao mới" });
  });

  describe("ticket chưa ai nhận bị nâng mức", () => {
    const raised = (from: any, to: any, actorId = REQUESTER) =>
      new TicketUrgencyRaisedDomainEvent({ aggregateId: "t1", actorId, from, to });
    const open = () => context({ status: "open" });

    it("nâng lên Cao / Khẩn → báo người phụ trách", () => {
      const planned = planNotifications(raised("normal", "high"), open());
      expect(recipients(planned)).toEqual(["handler-1", "handler-2"]);
      expect(planned[0]).toMatchObject({
        type: "urgency_raised",
        title: "Ticket được nâng lên mức Cao"
      });
      expect(planNotifications(raised("high", "urgent"), open())[0].title).toBe(
        "Ticket được nâng lên mức Khẩn"
      );
    });

    it("nâng lên mức thường (từ Thấp) thì không báo; người nâng mức không tự nhận thông báo", () => {
      expect(planNotifications(raised("low", "normal"), open())).toEqual([]);
      expect(recipients(planNotifications(raised("normal", "high", "handler-1"), open()))).toEqual([
        "handler-2"
      ]);
    });
  });

  it("ticket mức Cao đang chờ người tạo bổ sung tờ trình thì chưa báo", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: REQUESTER,
      urgency: "urgent"
    });
    expect(planNotifications(urgent, context({ status: "waiting_info" }))).toEqual([]);
  });

  it("người phụ trách chính là người tạo thì không tự nhận thông báo của mình", () => {
    const urgent = new TicketCreatedDomainEvent({
      aggregateId: "t1",
      actorId: "handler-1",
      urgency: "urgent"
    });
    expect(recipients(planNotifications(urgent, context()))).toEqual(["handler-2"]);
  });

  describe("giao việc", () => {
    const unowned = (overrides = {}, rest = {}) =>
      context(
        {
          assignment: { ...context().ticket.props.assignment, ownerId: null, collaboratorIds: [] },
          ...overrides
        },
        rest
      );
    const assigned = (
      mode: "members" | "department",
      extra: { memberIds?: string[]; previousHandlerIds?: string[]; actorId?: string } = {}
    ) =>
      new TicketAssignedDomainEvent({
        aggregateId: "t1",
        actorId: extra.actorId ?? BOSS,
        mode,
        departmentId: mode === "department" ? "dept-1" : null,
        memberIds: extra.memberIds ?? [],
        previousHandlerIds: extra.previousHandlerIds
      });
    const byType = (planned: ReturnType<typeof planNotifications>, type: string) =>
      planned.find((item) => item.type === type)?.employeeIds;

    it("giao đích danh → những người được giao; người tạo được báo ticket đã giao cho ai", () => {
      const planned = planNotifications(
        assigned("members", { memberIds: ["a", "b"] }),
        unowned({}, { assignmentTargetLabel: "A, B" })
      );
      expect(byType(planned, "assigned")).toEqual(["a", "b"]);
      expect(byType(planned, "assigned_requester")).toEqual([REQUESTER]);
      expect(planned.find((item) => item.type === "assigned_requester")?.body).toContain(
        "Giao cho: A, B"
      );
    });

    it("giao phòng ban có trưởng phòng → chỉ báo trưởng phòng (không báo cả phòng)", () => {
      const planned = planNotifications(
        assigned("department"),
        unowned({}, { departmentMemberIds: ["m1", "m2"] })
      );
      expect(byType(planned, "assigned_department")).toEqual(["dept-manager"]);
    });

    it("giao phòng ban chưa có người quản lý và chưa ai nhận → báo tất cả thành viên phòng", () => {
      const planned = planNotifications(
        assigned("department"),
        unowned({}, { departmentManagerId: null, departmentMemberIds: ["m1", "m2", BOSS] })
      );
      // Người giao (BOSS) không tự nhận thông báo
      expect(byType(planned, "assigned_department")).toEqual(["m1", "m2"]);
    });

    it("giao phòng ban mà ticket đã có người nhận → báo trưởng phòng + chủ trì + phối hợp, không báo cả phòng", () => {
      const claimed = context(
        {
          assignment: {
            ...context().ticket.props.assignment,
            ownerId: OWNER,
            collaboratorIds: ["c1"]
          }
        },
        { departmentManagerId: null, departmentMemberIds: ["m1", "m2"] }
      );
      expect(
        byType(planNotifications(assigned("department"), claimed), "assigned_department")
      ).toEqual([OWNER, "c1"]);
      const withManager = { ...claimed, departmentManagerId: "dept-manager" };
      expect(
        byType(planNotifications(assigned("department"), withManager), "assigned_department")
      ).toEqual(["dept-manager", OWNER, "c1"]);
    });

    it("giao lại → người cũ bị gỡ ra được báo; người vẫn ở trong nhóm mới không bị báo hai lần", () => {
      const planned = planNotifications(
        assigned("members", {
          memberIds: ["a", "b"],
          previousHandlerIds: ["old-owner", "old-collab", "a"]
        }),
        unowned()
      );
      expect(byType(planned, "unassigned")).toEqual(["old-owner", "old-collab"]);
      expect(byType(planned, "assigned")).toEqual(["a", "b"]);
    });

    it("không báo người tự giao; mỗi người chỉ nhận một thông báo cho một lần giao", () => {
      // Người tạo tự giao cho mình: không nhận thông báo nào của chính mình
      const selfAssigned = planNotifications(
        assigned("members", { memberIds: [REQUESTER], actorId: REQUESTER }),
        unowned()
      );
      expect(selfAssigned).toEqual([]);
      // Người tạo nằm trong danh sách được giao (người khác giao) → chỉ nhận "Bạn được giao", không thêm báo người tạo
      const inList = planNotifications(
        assigned("members", { memberIds: ["a", REQUESTER] }),
        unowned()
      );
      expect(recipients(inList)).toEqual(["a", REQUESTER]);
      expect(byType(inList, "assigned_requester")).toBeUndefined();
    });
  });

  it("có người nhận → báo người tạo; được thêm phối hợp → báo người được thêm", () => {
    expect(
      recipients(
        planNotifications(
          new TicketClaimedDomainEvent({ aggregateId: "t1", actorId: OWNER }),
          context()
        )
      )
    ).toEqual([REQUESTER]);
    expect(
      recipients(
        planNotifications(
          new TicketCollaboratorAddedDomainEvent({
            aggregateId: "t1",
            actorId: OWNER,
            collaboratorId: "emp-new"
          }),
          context()
        )
      )
    ).toEqual(["emp-new"]);
  });

  it("người tạo bổ sung xong → báo chủ trì và người phối hợp; chưa có chủ trì thì báo người phụ trách", () => {
    const event = new TicketInfoSubmittedDomainEvent({ aggregateId: "t1", actorId: REQUESTER });
    expect(recipients(planNotifications(event, context()))).toEqual([OWNER]);
    const withCollaborators = context({
      assignment: {
        ...context().ticket.props.assignment,
        collaboratorIds: ["collab-1", "collab-2", REQUESTER]
      }
    });
    // Người tạo (dù cũng nằm trong nhóm) không tự nhận thông báo của chính mình
    expect(recipients(planNotifications(event, withCollaborators))).toEqual([
      OWNER,
      "collab-1",
      "collab-2"
    ]);
    const noOwner = context({
      assignment: { ...context().ticket.props.assignment, ownerId: null }
    });
    const unclaimed = planNotifications(event, noOwner);
    expect(recipients(unclaimed)).toEqual(["handler-1", "handler-2"]);
    expect(unclaimed[0].type).toBe("info_submitted_unclaimed");
    expect(
      planNotifications(
        event,
        context({ assignment: noOwner.ticket.props.assignment }, { responsibleIds: [] })
      )
    ).toEqual([]);
  });

  it("tờ trình không hợp lệ → báo người tạo; hợp lệ → không báo", () => {
    expect(
      recipients(
        planNotifications(
          new TicketApprovalVerifiedDomainEvent({
            aggregateId: "t1",
            actorId: OWNER,
            valid: false
          }),
          context()
        )
      )
    ).toEqual([REQUESTER]);
    expect(
      planNotifications(
        new TicketApprovalVerifiedDomainEvent({ aggregateId: "t1", actorId: OWNER, valid: true }),
        context()
      )
    ).toEqual([]);
  });

  it("đã xử lý / đóng / tự đóng → báo người tạo; mở lại → báo chủ trì", () => {
    const status = (from: any, to: any, actorId: string | null, resolutionCode: any = null) =>
      new TicketStatusChangedDomainEvent({ aggregateId: "t1", actorId, from, to, resolutionCode });

    expect(
      recipients(planNotifications(status("in_progress", "resolved", OWNER), context()))
    ).toEqual([REQUESTER]);
    expect(
      recipients(planNotifications(status("in_progress", "closed", OWNER, "wont_fix"), context()))
    ).toEqual([REQUESTER]);

    const auto = planNotifications(status("resolved", "closed", null, "solved"), context());
    expect(auto[0].type).toBe("auto_closed");
    expect(auto[0].employeeIds).toEqual([REQUESTER]);

    expect(
      recipients(planNotifications(status("closed", "in_progress", REQUESTER), context()))
    ).toEqual([OWNER]);
  });

  it("đổi trạng thái không có trong bảng quy tắc (tạm hoãn, tiếp tục, trả lại) thì không báo", () => {
    const event = new TicketStatusChangedDomainEvent({
      aggregateId: "t1",
      actorId: OWNER,
      from: "in_progress",
      to: "on_hold"
    });
    expect(planNotifications(event, context())).toEqual([]);
  });
});

describe("planMessageNotifications — ai được báo khi có tin nhắn mới", () => {
  const COLLAB = "emp-collab";
  const message = (
    overrides: Partial<MessageNotificationContext> = {},
    ticketOverrides: Partial<PolicyContext["ticket"]["props"]> = {}
  ): MessageNotificationContext => ({
    ticket: context(ticketOverrides).ticket,
    authorId: REQUESTER,
    authorName: "Người tạo",
    body: "Khách vẫn chưa nhận được",
    mentionIds: [],
    responsibleIds: ["handler-1"],
    departmentManagerId: null,
    ...overrides
  });
  const withTeam = {
    assignment: {
      mode: "none" as const,
      departmentId: null,
      memberIds: [],
      assignedBy: null,
      ownerId: OWNER,
      collaboratorIds: [COLLAB],
      claimedAt: null
    }
  };
  const unclaimed = (overrides: Record<string, unknown> = {}) => ({
    status: "open" as const,
    assignment: {
      mode: "none" as const,
      departmentId: null,
      memberIds: [],
      assignedBy: null,
      ownerId: null,
      collaboratorIds: [],
      claimedAt: null,
      ...overrides
    }
  });

  it("người tạo nhắn → chủ trì và người phối hợp; người tạo không tự nhận", () => {
    const planned = planMessageNotifications(message({}, withTeam), false);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      type: "message",
      title: "Có trao đổi mới trong ticket TK-2610-0001",
      body: "Người tạo: Khách vẫn chưa nhận được"
    });
    expect(planned[0].employeeIds).toEqual([OWNER, COLLAB]);
  });

  it("chủ trì nhắn → người tạo và người phối hợp; chủ trì không tự nhận", () => {
    const planned = planMessageNotifications(message({ authorId: OWNER }, withTeam), false);
    expect(planned[0].employeeIds).toEqual([REQUESTER, COLLAB]);
  });

  it("người được nhắc tên chỉ nhận thông báo nhắc tên, không nhận thêm thông báo chung", () => {
    const planned = planMessageNotifications(message({ mentionIds: [COLLAB] }, withTeam), false);
    expect(planned.map((item) => [item.type, item.employeeIds])).toEqual([
      ["mention", [COLLAB]],
      ["message", [OWNER]]
    ]);
    expect(planned[0]).toMatchObject({
      title: "Bạn được nhắc tên trong ticket TK-2610-0001",
      body: "Khách vẫn chưa nhận được"
    });
  });

  it("người ngoài nhóm được nhắc tên cũng nhận thông báo nhắc tên; nhắc chính mình thì không", () => {
    const planned = planMessageNotifications(
      message({ mentionIds: ["emp-outsider", REQUESTER] }, withTeam),
      false
    );
    expect(planned[0]).toMatchObject({ type: "mention", employeeIds: ["emp-outsider"] });
  });

  it("ticket chưa có chủ trì: báo người được giao đích danh và người phụ trách", () => {
    const planned = planMessageNotifications(
      message({ authorId: "emp-other" }, unclaimed({ mode: "members", memberIds: ["m1", "m2"] })),
      false
    );
    expect(planned[0].employeeIds).toEqual([REQUESTER, "m1", "m2", "handler-1"]);
  });

  it("ticket chưa có chủ trì, giao cho phòng ban: báo trưởng phòng; không ai được giao thì chỉ người phụ trách", () => {
    const department = planMessageNotifications(
      message(
        { departmentManagerId: "dept-manager" },
        unclaimed({ mode: "department", departmentId: "d1" })
      ),
      false
    );
    expect(department[0].employeeIds).toEqual(["dept-manager", "handler-1"]);

    const none = planMessageNotifications(message({}, unclaimed()), false);
    expect(none[0].employeeIds).toEqual(["handler-1"]);
  });

  it("ticket chưa có chủ trì và đang chờ người tạo bổ sung: chưa báo người phụ trách", () => {
    const planned = planMessageNotifications(
      message({ authorId: "emp-other" }, { ...unclaimed(), status: "waiting_info" }),
      false
    );
    expect(planned[0].employeeIds).toEqual([REQUESTER]);
    expect(
      planMessageNotifications(message({}, { ...unclaimed(), status: "waiting_info" }), false)
    ).toEqual([]);
  });

  it("ticket hạn chế không đính kèm nội dung; tin chỉ có file ghi rõ là file", () => {
    const restricted = planMessageNotifications(message({ mentionIds: [COLLAB] }, withTeam), true);
    expect(restricted.map((item) => item.body)).toEqual(["", "Người tạo đã gửi tin nhắn mới"]);

    const filesOnly = planMessageNotifications(message({ body: "" }, withTeam), false);
    expect(filesOnly[0].body).toBe("Người tạo đã gửi file đính kèm");
  });

  it("nội dung dài được cắt gọn 140 ký tự", () => {
    const planned = planMessageNotifications(message({ body: "a".repeat(500) }, withTeam), false);
    expect(planned[0].body).toBe(`Người tạo: ${"a".repeat(140)}`);
  });
});

describe("resolveResponsibleIds — cộng dồn mẫu + loại + sản phẩm (+ mặc định cho ticket Khẩn / Cao)", () => {
  const sources = {
    templateIds: ["t1"],
    categoryIds: ["c1", "t1"],
    productIds: ["p1"],
    defaultIds: ["d1"]
  };

  it("ticket mức Khẩn và Cao: người của mẫu, loại, sản phẩm và mặc định cùng nhận, không trùng", () => {
    expect(resolveResponsibleIds("urgent", sources)).toEqual(["t1", "c1", "p1", "d1"]);
    expect(resolveResponsibleIds("high", sources)).toEqual(["t1", "c1", "p1", "d1"]);
  });

  it("ticket thường / thấp: chỉ người phụ trách cụ thể, danh sách mặc định không bị báo", () => {
    expect(resolveResponsibleIds("normal", sources)).toEqual(["t1", "c1", "p1"]);
    expect(resolveResponsibleIds("low", sources)).toEqual(["t1", "c1", "p1"]);
    expect(resolveResponsibleIds("normal", { defaultIds: ["d1"] })).toEqual([]);
  });

  it("thiếu cấp nào thì bỏ qua cấp đó; cấp trống không chặn cấp khác", () => {
    expect(resolveResponsibleIds("urgent", { defaultIds: ["d1"] })).toEqual(["d1"]);
    expect(resolveResponsibleIds("urgent", { productIds: ["p1"], defaultIds: [] })).toEqual(["p1"]);
    expect(resolveResponsibleIds("normal", {})).toEqual([]);
  });
});

describe("thứ tự hiển thị danh mục cấu hình — nhóm → ngày tạo", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  const product = (id: string, group: string, day: number) =>
    ({ id, group, createdAt: at(day) }) as any;

  it("sản phẩm: nhóm theo ngày tạo sớm nhất của nhóm, trong nhóm theo ngày tạo sản phẩm", () => {
    const sorted = sortProducts([
      product("t2", "TIKLUY", 6),
      product("v1", "VNFITE", 2),
      product("w1", "vWork", 9),
      product("t1", "TIKLUY", 3),
      product("v2", "VNFITE", 5),
      product("x1", "X FINANCE", 20)
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["v1", "v2", "t1", "t2", "w1", "x1"]);
  });

  it("loại yêu cầu theo ngày tạo; mẫu theo loại rồi ngày tạo", () => {
    const categories = [
      { id: "c2", createdAt: at(8) },
      { id: "c1", createdAt: at(1) }
    ] as any[];
    expect(sortCategories(categories).map((item) => item.id)).toEqual(["c1", "c2"]);
    const templates = [
      { id: "a", categoryId: "c2", createdAt: at(2) },
      { id: "b", categoryId: "c1", createdAt: at(9) },
      { id: "c", categoryId: "c1", createdAt: at(3) }
    ] as any[];
    expect(sortTemplates(templates, categories).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });
});

describe("buildListFilter", () => {
  const now = new Date("2026-10-26T09:00:00+07:00");

  it("ticket hạn chế chỉ hiện cho người liên quan, trừ người có quyền xem ticket hạn chế", () => {
    const filter = visibilityFilter(actor()) as { $or: Array<Record<string, unknown>> };
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { visibility: "normal" },
        { created_by: ME },
        { "assignment.owner_id": ME },
        { "assignment.collaborator_ids": ME },
        { "assignment.member_ids": ME }
      ])
    );
    expect(visibilityFilter(actor({ canViewRestricted: true }))).toEqual({});
  });

  it("tab 'unclaimed': chỉ ticket chưa giao cho ai (giao riêng / giao phòng nằm ở tab của người đó)", () => {
    expect(tabFilter({ tab: "unclaimed" }, actor(), now)).toEqual({
      status: "open",
      "assignment.owner_id": null,
      "assignment.mode": "none"
    });
  });

  it("tab 'my': gộp tôi tạo, tôi xử lý, giao cho tôi; chip lọc từng phần", () => {
    const all = tabFilter({ tab: "my" }, actor(), now) as { $or: unknown[] };
    expect(all.$or).toEqual(
      expect.arrayContaining([
        { created_by: ME },
        { status: "open", "assignment.owner_id": null, "assignment.member_ids": ME }
      ])
    );
    expect(tabFilter({ tab: "my", scope: "created" }, actor(), now)).toEqual({ created_by: ME });
    expect(tabFilter({ tab: "my", scope: "assigned" }, actor(), now)).toEqual({
      status: "open",
      "assignment.owner_id": null,
      "assignment.member_ids": ME
    });
    // "Đang mở" loại ticket đã đóng/huỷ, "Tất cả" thì giữ lại
    const open = tabFilter({ tab: "my", scope: "open" }, actor(), now) as { $and: unknown[] };
    expect(open.$and).toContainEqual({
      status: { $in: ["open", "in_progress", "waiting_info", "on_hold", "resolved"] }
    });
    expect(JSON.stringify(all)).not.toContain('"status":{"$in"');
    // scope lạ rơi về "all"
    expect(tabFilter({ tab: "my", scope: "hack" }, actor(), now)).toEqual(all);
  });

  it("tab 'needs_reply': ticket tôi tạo đang chờ bổ sung hoặc chờ xác nhận", () => {
    expect(tabFilter({ tab: "needs_reply" }, actor(), now)).toEqual({
      created_by: ME,
      status: { $in: ["waiting_info", "resolved"] }
    });
  });

  it("tab 'department': giao cho phòng tôi + việc của người trong phòng", () => {
    const people = ["emp-1", "emp-2"];
    expect(
      tabFilter({ tab: "department", scope: "waiting" }, actor(), now, {
        departmentEmployeeIds: people
      })
    ).toEqual({
      status: "open",
      "assignment.owner_id": null,
      "assignment.mode": "department",
      "assignment.department_id": { $in: ["dept-1"] }
    });
    expect(
      tabFilter({ tab: "department", scope: "created" }, actor(), now, {
        departmentEmployeeIds: people
      })
    ).toEqual({ created_by: { $in: people } });
    const all = tabFilter({ tab: "department" }, actor(), now, {
      departmentEmployeeIds: people
    }) as { $or: unknown[] };
    expect(all.$or).toHaveLength(3);
    // Không có ai trong phòng → không khớp ticket nào của "người trong phòng" (không lọt cả công ty)
    expect(tabFilter({ tab: "department", scope: "created" }, actor(), now)).toEqual({
      created_by: { $in: [] }
    });
  });

  it("tab 'yellow': ticket còn xử lý dở và đã quá mốc cảnh báo", () => {
    expect(tabFilter({ tab: "yellow" }, actor(), now)).toEqual({
      status: { $in: ["open", "in_progress", "on_hold"] },
      alert_at: { $lte: now }
    });
  });

  it("từ khoá được escape, các điều kiện gộp bằng $and để $or không đè nhau", () => {
    const filter = buildListFilter({ tab: "unclaimed", q: "a.b*(c" }, actor(), now) as {
      $and: Array<Record<string, any>>;
    };
    expect(Array.isArray(filter.$and)).toBe(true);
    const keywordPart = filter.$and.find((part) =>
      part.$or?.some((item: any) => item.code instanceof RegExp)
    );
    const regex = keywordPart!.$or[0].code as RegExp;
    expect(regex.test("xa.b*(cx")).toBe(true);
    expect(regex.test("xaXb")).toBe(false); // "." không còn là ký tự đại diện
  });

  it("lọc theo sản phẩm / mức khẩn / khoảng ngày", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const filter = buildListFilter({ productId: "p1", urgency: "urgent", from }, actor(), now) as {
      $and: Array<Record<string, any>>;
    };
    const direct = filter.$and.find((part) => part.product_id);
    expect(direct).toMatchObject({
      product_id: "p1",
      urgency: "urgent",
      createdAt: { $gte: from }
    });
  });
});

describe("capabilitiesOf", () => {
  const base = {
    status: "open" as const,
    createdBy: REQUESTER,
    assignment: {
      mode: "none" as const,
      departmentId: null,
      memberIds: [],
      assignedBy: null,
      ownerId: null,
      collaboratorIds: [],
      claimedAt: null
    },
    approval: {
      required: false,
      source: null,
      mode: "document" as const,
      status: "not_required" as const,
      reference: null,
      verifiedBy: null,
      verifiedAt: null,
      note: ""
    },
    confirmedByRequester: false,
    reopenUntil: null
  };

  it("ticket mới chưa ai nhận: ai cũng nhận được; người tạo sửa/huỷ được nhưng không đổi trạng thái xử lý", () => {
    const stranger = capabilitiesOf(base, actor());
    expect(stranger.claim).toBe(true);
    expect(stranger.resolve).toBe(false);
    expect(stranger.cancel).toBe(false);

    const requester = capabilitiesOf(base, actor({ employeeId: REQUESTER }));
    expect(requester).toMatchObject({ edit: true, cancel: true, resolve: false, close: false });
  });

  it("chủ trì và phối hợp có quyền như nhau; chủ trì mới được 'Trả lại' khi là chủ trì", () => {
    const ticket = {
      ...base,
      status: "in_progress" as const,
      assignment: { ...base.assignment, ownerId: OWNER, collaboratorIds: ["emp-collab"] }
    };
    const owner = capabilitiesOf(ticket, actor({ employeeId: OWNER }));
    const collaborator = capabilitiesOf(ticket, actor({ employeeId: "emp-collab" }));
    expect(owner).toMatchObject({ resolve: true, hold: true, requestInfo: true, release: true });
    expect(collaborator).toMatchObject({
      resolve: true,
      hold: true,
      requestInfo: true,
      release: false
    });
    expect(collaborator.claim).toBe(false);
  });

  it("đã xử lý: người tạo xác nhận/mở lại được; đã đóng sau hạn thì không mở lại được", () => {
    const resolved = { ...base, status: "resolved" as const };
    expect(capabilitiesOf(resolved, actor({ employeeId: REQUESTER }))).toMatchObject({
      confirm: true,
      reopen: true
    });

    const now = new Date("2026-10-26T09:00:00+07:00");
    const closed = {
      ...base,
      status: "closed" as const,
      reopenUntil: new Date("2026-10-28T09:00:00+07:00")
    };
    expect(capabilitiesOf(closed, actor({ employeeId: REQUESTER }), now).reopen).toBe(true);
    expect(
      capabilitiesOf(
        closed,
        actor({ employeeId: REQUESTER }),
        new Date("2026-10-29T09:00:00+07:00")
      ).reopen
    ).toBe(false);
    expect(
      capabilitiesOf(
        { ...closed, confirmedByRequester: true },
        actor({ employeeId: REQUESTER }),
        now
      ).reopen
    ).toBe(false);
  });

  it("xác nhận tờ trình: nhóm xử lý hoặc người có quyền xem hạn chế, không phải người tạo", () => {
    const ticket = {
      ...base,
      status: "in_progress" as const,
      assignment: { ...base.assignment, ownerId: OWNER },
      approval: { ...base.approval, required: true, status: "submitted" as const }
    };
    expect(capabilitiesOf(ticket, actor({ employeeId: OWNER })).verifyApproval).toBe(true);
    expect(
      capabilitiesOf(ticket, actor({ employeeId: BOSS, canViewRestricted: true })).verifyApproval
    ).toBe(true);
    expect(capabilitiesOf(ticket, actor({ employeeId: REQUESTER })).verifyApproval).toBe(false);
  });

  it("giao việc: cần quyền giao phòng hoặc giao người", () => {
    expect(capabilitiesOf(base, actor()).assign).toBe(false);
    expect(capabilitiesOf(base, actor({ canAssignMember: true })).assign).toBe(true);
  });
});

describe("request parsers", () => {
  it("readPayload: multipart gửi JSON trong 'payload', JSON thường dùng body", () => {
    expect(readPayload({ body: { payload: '{"title":"A"}' } } as any)).toEqual({ title: "A" });
    expect(readPayload({ body: { title: "B" } } as any)).toEqual({ title: "B" });
    expect(() => readPayload({ body: { payload: "{hỏng" } } as any)).toThrow();
  });

  it("parseListQuery bỏ qua tab/urgency lạ", () => {
    const query = parseListQuery({
      tab: "hack",
      urgency: "x",
      status: "open,closed",
      q: " otp "
    } as any);
    expect(query).toMatchObject({
      tab: undefined,
      scope: undefined,
      urgency: undefined,
      status: ["open", "closed"],
      q: "otp"
    });
  });

  it("parseListQuery: scope chỉ hợp lệ với tab có chip, còn lại rơi về 'all'", () => {
    expect(parseListQuery({ tab: "my", scope: "created" } as any)).toMatchObject({
      tab: "my",
      scope: "created"
    });
    expect(parseListQuery({ tab: "department", scope: "waiting" } as any).scope).toBe("waiting");
    expect(parseListQuery({ tab: "my", scope: "waiting" } as any).scope).toBe("all");
    expect(parseListQuery({ tab: "yellow", scope: "created" } as any).scope).toBe("all");
  });

  it("contentTypeFor: chỉ định dạng an toàn mới xem trực tiếp; html/svg buộc tải về", () => {
    expect(contentTypeFor("a.PNG")).toEqual({ type: "image/png", inline: true });
    expect(contentTypeFor("a.pdf").inline).toBe(true);
    expect(contentTypeFor("loi.MOV")).toEqual({ type: "video/quicktime", inline: true });
    expect(contentTypeFor("loi.mp4")).toEqual({ type: "video/mp4", inline: true });
    expect(contentTypeFor("evil.html")).toEqual({
      type: "application/octet-stream",
      inline: false
    });
    expect(contentTypeFor("evil.svg").inline).toBe(false);
    expect(contentTypeFor("file.xlsx").inline).toBe(false);
  });
});
