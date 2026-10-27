import "dotenv/config";
import mongoose from "mongoose";
import TicketActivityModel from "../src/models/TicketActivityModel";
import TicketCategoryModel from "../src/models/TicketCategoryModel";
import TicketMessageModel from "../src/models/TicketMessageModel";
import TicketModel from "../src/models/TicketModel";
import TicketProductModel from "../src/models/TicketProductModel";
import TicketTemplateModel from "../src/models/TicketTemplateModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import UserInfoModel from "../src/models/UserInfoModel";
import { refreshSchedule } from "../src/modules/ticket/application/ticket-scheduling";
import { computeReopenUntil } from "../src/modules/ticket/domain/ticket-schedule";
import { TicketEntity } from "../src/modules/ticket/domain/ticket.entity";
import { TicketRepository } from "../src/modules/ticket/infrastructure/ticket.repository";
import { nextTicketCode } from "../src/modules/ticket/infrastructure/ticket-code.generator";
import { MongooseSchedulerLoader } from "../src/modules/ticket/infrastructure/ticket-scheduler.loader";

// Tạo ~20 ticket DỮ LIỆU TEST để xem đủ các tab / trạng thái trên màn Ticket. An toàn:
//   - KHÔNG gửi thông báo cho ai: dựng ticket bằng domain entity + ghi thẳng DB, không phát domain event.
//   - Mọi ticket có tiêu đề "[TEST] ..." và mô tả bắt đầu bằng "[Dữ liệu test]" để nhận ra / xoá được.
//   - Dùng nhân viên THẬT trong DB (chỉ làm người tạo / chủ trì); SĐT khách là số giả 0900000xxx.
// Chạy:   npx ts-node --transpile-only scripts/seedTicketTestData.ts
// Xoá:    npx ts-node --transpile-only scripts/seedTicketTestData.ts --remove

const MARKER = "[Dữ liệu test]";
const TITLE_PREFIX = "[TEST] ";

// Hai tài khoản đang đăng nhập web để thử: nửa dữ liệu xoay quanh mỗi người
const ADMIN = "Quản trị hệ thống";
const NGHIEM = "Bùi Văn Nghiêm";
// Đồng nghiệp cùng phòng với Nghiêm (Khối Công Nghệ) và những người khác
const PEOPLE = [
  ADMIN,
  NGHIEM,
  "Mai Ngọc Đoàn",
  "Nguyễn Văn Lam",
  "Vũ Thành Vinh",
  "Lê Văn Linh",
  "Kiên Đẹp Trai",
  "Lê Thị Mai Hoa",
  "Trịnh Minh Thuỷ",
  "Nguyễn Vũ Trung"
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// "n ngày trước lúc h:mm giờ VN" (không vượt quá hiện tại)
function ago(days: number, hour = 9, minute = 0): Date {
  const now = Date.now();
  const vn = new Date(now + 7 * HOUR);
  const base = Date.UTC(
    vn.getUTCFullYear(),
    vn.getUTCMonth(),
    vn.getUTCDate() - days,
    hour - 7,
    minute
  );
  return new Date(Math.min(base, now - 5 * 60 * 1000));
}
const later = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

interface Step {
  when: Date;
  run: () => void;
}

interface Scenario {
  label: string;
  title: string;
  description: string;
  product: string;
  category: string;
  template?: string;
  urgency?: "urgent" | "high" | "normal" | "low";
  createdBy: string;
  createdAt: Date;
  customer?: { phone: string; name: string; appCode: string | null; externalId?: string };
  customFields?: Record<string, unknown>;
  assignment?: {
    mode: "members" | "department";
    memberIds?: string[];
    departmentId?: string;
    by: string;
  };
  approvalRequired?: boolean;
  // Các bước xử lý, theo thứ tự thời gian; nhận `who` (tên → id) để dựng
  steps?: (
    who: (name: string) => string,
    entity: TicketEntity,
    helpers: { reopenUntil: (closedAt: Date) => Date }
  ) => Step[];
  messages?: Array<{ author: string; body: string; at: Date }>;
}

const phone = (n: number) => `09000000${String(n).padStart(2, "0")}`;

function buildScenarios(deptKhoiCn: string): Scenario[] {
  return [
    // ===== Xoay quanh tài khoản Quản trị hệ thống =====
    {
      label: "A1 admin tạo, chưa ai nhận",
      title: `[TIKLUY APP] Không cộng lãi – ${phone(1)}`,
      description: "Khách báo kỳ lãi hôm qua chưa về tài khoản.",
      product: "tikluy_app",
      category: "transaction_interest",
      createdBy: ADMIN,
      createdAt: ago(1, 9, 30),
      customer: { phone: phone(1), name: "Khách test 01", appCode: "tikluy" }
    },
    {
      label: "A2 admin tạo, chờ admin bổ sung",
      title: `[VNFITE APP] Làm lại eKYC – ${phone(2)}`,
      description: "Khách bị khoá eKYC sau lần xác thực thứ 3.",
      product: "vnfite_app",
      category: "customer_account",
      createdBy: ADMIN,
      createdAt: ago(2, 9),
      customer: { phone: phone(2), name: "Khách test 02", appCode: "vnfite" },
      steps: (who, e) => [
        { when: ago(2, 10), run: () => e.claim(who("Vũ Thành Vinh"), [], ago(2, 10)) },
        {
          when: ago(1, 14),
          run: () =>
            e.requestInfo(
              {
                items: [
                  { key: "screenshot", label: "Ảnh/video chụp lỗi" },
                  { key: "customer_phone", label: "Số điện thoại khách" }
                ],
                note: "Anh gửi giúp ảnh màn hình báo lỗi nhé",
                requestedBy: who("Vũ Thành Vinh")
              },
              ago(1, 14)
            )
        }
      ]
    },
    {
      label: "A3 admin tạo, chờ admin xác nhận",
      title: "[HRM] Sai công tháng 10 của nhân viên mới",
      description: "Bảng công không hiện ngày đi làm 12/10.",
      product: "vwork_hrm",
      category: "incident",
      createdBy: ADMIN,
      createdAt: ago(3, 9),
      steps: (who, e) => [
        { when: ago(3, 10), run: () => e.claim(who("Lê Văn Linh"), [], ago(3, 10)) },
        {
          when: ago(1, 16),
          run: () =>
            e.resolve(
              {
                note: "Đã đối soát và cập nhật lại công",
                actionTaken: "Chạy lại đối soát công",
                by: who("Lê Văn Linh")
              },
              ago(1, 16)
            )
        }
      ]
    },
    {
      label: "A4 admin tạo, đã xác nhận xong",
      title: "[CRM] Không xuất được danh sách khách",
      description: "Bấm xuất Excel báo lỗi 500.",
      product: "vwork_crm",
      category: "incident",
      createdBy: ADMIN,
      createdAt: ago(6, 9),
      steps: (who, e) => [
        { when: ago(6, 10), run: () => e.claim(who("Nguyễn Vũ Trung"), [], ago(6, 10)) },
        {
          when: ago(5, 11),
          run: () =>
            e.resolve(
              {
                note: "Đã sửa và triển khai",
                actionTaken: "Fix lỗi timeout khi xuất",
                by: who("Nguyễn Vũ Trung")
              },
              ago(5, 11)
            )
        },
        { when: ago(5, 15), run: () => e.confirm(who(ADMIN), ago(5, 15)) }
      ]
    },
    {
      label: "A5 admin đang xử lý (chủ trì)",
      title: `[TIKLUY CMS] Reset thiết bị – ${phone(5)}`,
      description: "Khách đổi điện thoại mới, cần reset thiết bị.",
      product: "tikluy_cms",
      category: "customer_account",
      template: "reset_device",
      urgency: "urgent",
      createdBy: "Lê Thị Mai Hoa",
      createdAt: ago(1, 8, 30),
      customer: { phone: phone(5), name: "Khách test 05", appCode: "tikluy" },
      steps: (who, e) => [{ when: ago(1, 9), run: () => e.claim(who(ADMIN), [], ago(1, 9)) }],
      messages: [
        {
          author: "Lê Thị Mai Hoa",
          body: "Khách đã gửi CCCD qua Zalo, em nhờ anh xử lý giúp.",
          at: ago(1, 9, 20)
        },
        {
          author: ADMIN,
          body: "Anh đã nhận, đang kiểm tra thiết bị cũ của khách.",
          at: ago(1, 9, 40)
        }
      ]
    },
    {
      label: "A6 admin tạm hoãn",
      title: `[TIKLUY APP] Rút tiền bị treo – ${phone(6)}`,
      description: "Lệnh rút 20.000.000đ quá 1 ngày chưa về ngân hàng.",
      product: "tikluy_app",
      category: "transaction_interest",
      template: "withdraw_deposit_stuck",
      createdBy: "Trịnh Minh Thuỷ",
      createdAt: ago(2, 9),
      customer: { phone: phone(6), name: "Khách test 06", appCode: "tikluy" },
      steps: (who, e) => [
        { when: ago(2, 10), run: () => e.claim(who(ADMIN), [], ago(2, 10)) },
        {
          when: ago(1, 9),
          run: () => e.hold(who(ADMIN), "Chờ ngân hàng đối soát giao dịch", ahead(2), ago(1, 9))
        }
      ]
    },
    {
      label: "A7 admin phối hợp",
      title: "[VNFITE CMS] Sai báo cáo lãi tháng",
      description: "Số liệu báo cáo lệch so với sao kê.",
      product: "vnfite_cms",
      category: "incident",
      urgency: "urgent",
      createdBy: "Mai Ngọc Đoàn",
      createdAt: ago(1, 9),
      steps: (who, e) => [
        { when: ago(1, 9, 30), run: () => e.claim(who("Vũ Thành Vinh"), [], ago(1, 9, 30)) },
        {
          when: ago(1, 10),
          run: () => e.addCollaborator(who("Vũ Thành Vinh"), who(ADMIN), ago(1, 10))
        }
      ],
      messages: [
        {
          author: "Vũ Thành Vinh",
          body: "Mình thêm admin vào để cùng đối chiếu dữ liệu nhé.",
          at: ago(1, 10, 5)
        }
      ]
    },
    {
      label: "A8 giao đích danh cho admin",
      title: "[Workplace] Cấp quyền xem báo cáo tuần cho phòng Kế toán",
      description: "Phòng Kế toán chưa xem được mục báo cáo tuần.",
      product: "vwork_workplace",
      category: "internal_access",
      createdBy: "Mai Ngọc Đoàn",
      createdAt: ago(0, 8, 30),
      assignment: { mode: "members", memberIds: [ADMIN, "Nguyễn Văn Lam"], by: "Mai Ngọc Đoàn" }
    },
    {
      label: "A9 khẩn, chưa ai nhận → vàng",
      title: `[VNFITE APP] Đăng nhập lỗi liên tục – ${phone(9)}`,
      description: "Nhiều khách báo không đăng nhập được từ sáng.",
      product: "vnfite_app",
      category: "incident",
      urgency: "urgent",
      createdBy: "Lê Thị Mai Hoa",
      createdAt: ago(2, 9),
      customer: { phone: phone(9), name: "Khách test 09", appCode: "vnfite" }
    },
    {
      label: "A10 im lặng lâu → vàng",
      title: "[CRM] Màn hình khách hàng tải chậm",
      description: "Mở danh sách khách mất hơn 20 giây.",
      product: "vwork_crm",
      category: "incident",
      createdBy: "Nguyễn Văn Lam",
      createdAt: ago(8, 9),
      steps: (who, e) => [
        { when: ago(7, 10), run: () => e.claim(who("Kiên Đẹp Trai"), [], ago(7, 10)) }
      ]
    },

    // ===== Xoay quanh tài khoản Bùi Văn Nghiêm (Khối Công Nghệ) =====
    {
      label: "N1 Nghiêm tạo, chưa ai nhận",
      title: "[CRM] Đề xuất thêm bộ lọc theo chi nhánh",
      description: "Sale muốn lọc khách theo chi nhánh ngay trên danh sách.",
      product: "vwork_crm",
      category: "feature_request",
      urgency: "low",
      createdBy: NGHIEM,
      createdAt: ago(1, 10)
    },
    {
      label: "N2 Nghiêm tạo, đồng nghiệp đang xử lý",
      title: `[TIKLUY APP] Quên mật khẩu – ${phone(12)}`,
      description: "Khách không nhận được OTP đặt lại mật khẩu.",
      product: "tikluy_app",
      category: "customer_account",
      template: "forgot_password",
      urgency: "urgent",
      createdBy: NGHIEM,
      createdAt: ago(0, 8, 15),
      customer: { phone: phone(12), name: "Khách test 12", appCode: "tikluy" },
      steps: (who, e) => [
        {
          when: ago(0, 8, 40),
          run: () => e.claim(who("Vũ Thành Vinh"), [deptKhoiCn], ago(0, 8, 40))
        }
      ],
      messages: [
        {
          author: "Vũ Thành Vinh",
          body: "Đã gửi lại OTP qua kênh dự phòng, nhờ em báo khách thử lại.",
          at: ago(0, 9)
        }
      ]
    },
    {
      label: "N3 Nghiêm tạo, chờ Nghiêm xác nhận (cần theo dõi thêm)",
      title: `[TIKLUY APP] Không cộng lãi – ${phone(13)}`,
      description: "Kỳ lãi 15/10 chưa được cộng cho khoản đầu tư.",
      product: "tikluy_app",
      category: "transaction_interest",
      template: "interest_not_credited",
      createdBy: NGHIEM,
      createdAt: ago(3, 9),
      customer: { phone: phone(13), name: "Khách test 13", appCode: "tikluy" },
      steps: (who, e) => [
        { when: ago(3, 10), run: () => e.claim(who("Lê Văn Linh"), [deptKhoiCn], ago(3, 10)) },
        {
          when: ago(1, 15),
          run: () =>
            e.resolve(
              {
                note: "Đã bù lãi cho kỳ 15/10",
                actionTaken: "Chạy bù lãi trong CMS TIKLUY",
                followUp: {
                  note: "Kiểm tra kỳ lãi tiếp theo có cộng đúng không",
                  checkAt: ahead(4)
                },
                by: who("Lê Văn Linh")
              },
              ago(1, 15)
            )
        }
      ]
    },
    {
      label: "N4 Nghiêm đang xử lý (chủ trì)",
      title: `[VNFITE CMS] Mở khoá eKYC – ${phone(14)}`,
      description: "Khách xác thực khuôn mặt thất bại nhiều lần.",
      product: "vnfite_cms",
      category: "customer_account",
      template: "ekyc_unlock",
      createdBy: "Trịnh Minh Thuỷ",
      createdAt: ago(1, 13),
      customer: { phone: phone(14), name: "Khách test 14", appCode: "vnfite" },
      steps: (who, e) => [
        { when: ago(1, 14), run: () => e.claim(who(NGHIEM), [deptKhoiCn], ago(1, 14)) }
      ]
    },
    {
      label: "N5 giao đích danh cho Nghiêm",
      title: "[HRM] Nhân viên mới chưa có tài khoản chấm công",
      description: "Cần tạo tài khoản và gán ca làm việc.",
      product: "vwork_hrm",
      category: "internal_access",
      createdBy: "Nguyễn Văn Lam",
      createdAt: ago(0, 9),
      assignment: { mode: "members", memberIds: [NGHIEM], by: "Mai Ngọc Đoàn" }
    },
    {
      label: "N6 giao cho Khối Công Nghệ, chờ phòng nhận",
      title: `[TIKLUY CMS] Tất toán trước hạn – ${phone(16)}`,
      description: "Khách xin tất toán trước hạn ngoài quy định, đã có tờ trình.",
      product: "tikluy_cms",
      category: "transaction_interest",
      createdBy: "Mai Ngọc Đoàn",
      createdAt: ago(0, 8),
      customer: { phone: phone(16), name: "Khách test 16", appCode: "tikluy" },
      assignment: { mode: "department", departmentId: deptKhoiCn, by: "Mai Ngọc Đoàn" }
    },
    {
      label: "N7 đồng nghiệp phòng Nghiêm đang xử lý",
      title: `[VNFITE APP] Lỗi hiển thị số dư – ${phone(17)}`,
      description: "Số dư trên app lệch so với CMS.",
      product: "vnfite_app",
      category: "incident",
      createdBy: "Nguyễn Văn Lam",
      createdAt: ago(1, 11),
      customer: { phone: phone(17), name: "Khách test 17", appCode: "vnfite" },
      steps: (who, e) => [
        {
          when: ago(1, 11, 30),
          run: () => e.claim(who("Lê Văn Linh"), [deptKhoiCn], ago(1, 11, 30))
        }
      ],
      messages: [
        { author: "Lê Văn Linh", body: "Đang đối chiếu dữ liệu giữa app và CMS.", at: ago(1, 12) }
      ]
    },
    {
      label: "N8 đồng nghiệp phòng Nghiêm tạo, đã đóng",
      title: "[CRM] Không thấy khách vừa nhập",
      description: "Sale nhập khách mới nhưng tìm không ra.",
      product: "vwork_crm",
      category: "question",
      createdBy: "Kiên Đẹp Trai",
      createdAt: ago(4, 9),
      steps: (who, e, h) => [
        { when: ago(4, 10), run: () => e.claim(who("Nguyễn Vũ Trung"), [deptKhoiCn], ago(4, 10)) },
        {
          when: ago(3, 9),
          run: () =>
            e.close(
              {
                code: "not_a_bug",
                note: "Khách thuộc chi nhánh khác nên không nằm trong phạm vi xem của sale",
                by: who("Nguyễn Vũ Trung"),
                reopenUntil: h.reopenUntil(ago(3, 9))
              },
              ago(3, 9)
            )
        }
      ]
    },
    {
      label: "N9 ticket hạn chế (cần tờ trình)",
      title: `[TIKLUY CMS] Đổi SĐT ${phone(19)} → ${phone(20)}`,
      description: "Khách đổi số điện thoại, cần tờ trình có chữ ký.",
      product: "tikluy_cms",
      category: "customer_data_change",
      template: "change_phone",
      createdBy: NGHIEM,
      createdAt: ago(1, 15),
      customer: { phone: phone(19), name: "Khách test 19", appCode: "tikluy" },
      customFields: { old_phone: phone(19), new_phone: phone(20) },
      approvalRequired: true
    },
    {
      label: "N10 Nghiêm tạo rồi huỷ",
      title: "[Workplace] Tạo nhầm ticket",
      description: "Tạo nhầm, người tạo tự huỷ.",
      product: "vwork_workplace",
      category: "other",
      createdBy: NGHIEM,
      createdAt: ago(2, 14),
      steps: (who, e) => [
        {
          when: ago(2, 14, 20),
          run: () => e.cancel(who(NGHIEM), "Tạo nhầm, không cần xử lý", ago(2, 14, 20))
        }
      ]
    }
  ];
}

async function remove(): Promise<void> {
  const tickets = await TicketModel.find({
    isDeleted: false,
    description: /^\[Dữ liệu test\]/
  })
    .select("_id")
    .lean();
  const ids = tickets.map((ticket: any) => ticket._id);
  await TicketModel.updateMany(
    { _id: { $in: ids } },
    { $set: { isDeleted: true } },
    { timestamps: false }
  );
  await TicketMessageModel.updateMany(
    { ticket_id: { $in: ids } },
    { $set: { isDeleted: true } },
    { timestamps: false }
  );
  await TicketActivityModel.updateMany(
    { ticket_id: { $in: ids } },
    { $set: { isDeleted: true } },
    { timestamps: false }
  );
  console.log(`🧹 Đã xoá mềm ${ids.length} ticket test (kèm tin nhắn, lịch sử).`);
}

async function seed(): Promise<void> {
  const people = await UserInfoModel.find({ full_name: { $in: PEOPLE }, isDeleted: false })
    .select("full_name")
    .lean();
  const idByName = new Map<string, string>(
    (people as any[]).map((person) => [person.full_name, String(person._id)])
  );
  const missing = PEOPLE.filter((name) => !idByName.has(name));
  if (missing.length) throw new Error(`Không tìm thấy nhân viên: ${missing.join(", ")}`);
  const who = (name: string) => {
    const id = idByName.get(name);
    if (!id) throw new Error(`Không có nhân viên "${name}"`);
    return id;
  };

  const membership: any = await UserDepartmentPositionModel.findOne({
    user: who(NGHIEM),
    isDeleted: false
  }).lean();
  if (!membership) throw new Error(`${NGHIEM} chưa thuộc phòng ban nào`);
  const deptKhoiCn = String(membership.department);

  const byCode = async (model: any) =>
    new Map<string, any>(
      (await model.find({ isDeleted: false }).lean()).map((doc: any) => [doc.code, doc])
    );
  const [products, categories, templates] = await Promise.all([
    byCode(TicketProductModel),
    byCode(TicketCategoryModel),
    byCode(TicketTemplateModel)
  ]);
  const pick = (map: Map<string, any>, code: string) => {
    const doc = map.get(code);
    if (!doc) throw new Error(`Thiếu cấu hình "${code}" — chạy scripts/seedTicketConfig.ts trước`);
    return String(doc._id);
  };

  const existing = await TicketModel.countDocuments({
    isDeleted: false,
    description: /^\[Dữ liệu test\]/
  });
  if (existing > 0) {
    throw new Error(`Đã có ${existing} ticket test. Chạy với --remove để xoá trước khi tạo lại.`);
  }

  const repository = new TicketRepository();
  const scheduler = await new MongooseSchedulerLoader().load(new Date());

  let created = 0;
  for (const scenario of buildScenarios(deptKhoiCn)) {
    const code = await nextTicketCode(new Date());
    const ticket = TicketEntity.create(
      {
        code,
        title: TITLE_PREFIX + scenario.title.replace(/^\[TEST\] /, ""),
        description: `${MARKER} ${scenario.description}`,
        productId: pick(products, scenario.product),
        categoryId: pick(categories, scenario.category),
        templateId: scenario.template ? pick(templates, scenario.template) : null,
        customFields: scenario.customFields ?? {},
        urgency: scenario.urgency ?? "normal",
        customer: scenario.customer
          ? { ...scenario.customer, externalId: scenario.customer.externalId ?? null }
          : null,
        createdBy: who(scenario.createdBy),
        approvalRequired: scenario.approvalRequired,
        assignment: scenario.assignment
          ? {
              mode: scenario.assignment.mode,
              memberIds: (scenario.assignment.memberIds ?? []).map(who),
              departmentId: scenario.assignment.departmentId,
              assignedBy: who(scenario.assignment.by)
            }
          : null
      },
      scenario.createdAt
    );

    // Gom nhật ký theo từng bước để gắn đúng thời điểm
    const timeline: Array<{ draft: any; when: Date }> = ticket
      .pullActivities()
      .map((draft) => ({ draft, when: later(scenario.createdAt, 0) }));
    const helpers = {
      reopenUntil: (closedAt: Date) =>
        computeReopenUntil(closedAt, scheduler.policy, scheduler.calendar)
    };
    for (const step of scenario.steps?.(who, ticket, helpers) ?? []) {
      step.run();
      ticket.pullActivities().forEach((draft) => timeline.push({ draft, when: step.when }));
    }
    refreshSchedule(ticket, scheduler);

    await repository.insert(ticket);
    await TicketModel.updateOne(
      { _id: ticket.id },
      {
        $set: {
          createdAt: scenario.createdAt,
          updatedAt: timeline[timeline.length - 1]?.when ?? scenario.createdAt
        }
      },
      { timestamps: false }
    );
    if (timeline.length) {
      await TicketActivityModel.insertMany(
        timeline.map(({ draft, when }) => ({
          ticket_id: ticket.id,
          actor_id: draft.actorId,
          action: draft.action,
          from: draft.from ?? null,
          to: draft.to ?? null,
          changes: draft.changes ?? [],
          note: draft.note ?? "",
          createdAt: when,
          updatedAt: when
        })),
        { ordered: true }
      );
    }
    if (scenario.messages?.length) {
      await TicketMessageModel.insertMany(
        scenario.messages.map((message) => ({
          ticket_id: ticket.id,
          author_id: who(message.author),
          body: message.body,
          mention_ids: [],
          createdAt: message.at,
          updatedAt: message.at
        }))
      );
    }

    created += 1;
    console.log(`✅ ${code}  ${ticket.status.padEnd(12)} ${scenario.label}`);
  }
  console.log(`\n🎉 Đã tạo ${created} ticket test (không gửi thông báo cho ai).`);
}

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");
  if (process.argv.includes("--remove")) await remove();
  else await seed();
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Lỗi:", error.message);
  process.exit(1);
});
