import "dotenv/config";
import mongoose from "mongoose";
import TicketCategoryModel from "../src/models/TicketCategoryModel";
import TicketProductModel from "../src/models/TicketProductModel";
import TicketSettingModel from "../src/models/TicketSettingModel";
import TicketTemplateModel from "../src/models/TicketTemplateModel";

// Seed cấu hình ban đầu của ticket (docs/TICKET-MODULE-PLAN.md mục 2): sản phẩm, loại yêu cầu, mẫu yêu
// cầu và cài đặt chung. CHỈ TẠO MỚI nếu chưa có (theo code) — không ghi đè những gì quản trị đã chỉnh
// trên màn cấu hình. Người phụ trách (handler_ids) để trống: gán trên màn cấu hình sau khi chốt tên
// (vd người A, B phụ trách "Reset thiết bị").

const PRODUCTS = [
  { code: "vnfite_app", name: "VNFITE APP", group: "VNFITE", app_code: "vnfite" },
  { code: "vnfite_cms", name: "VNFITE CMS", group: "VNFITE", app_code: "vnfite" },
  { code: "tikluy_app", name: "TIKLUY APP", group: "TIKLUY", app_code: "tikluy" },
  { code: "tikluy_cms", name: "TIKLUY CMS", group: "TIKLUY", app_code: "tikluy" },
  { code: "vwork_crm", name: "CRM", group: "vWork", app_code: null },
  { code: "vwork_hrm", name: "HRM", group: "vWork", app_code: null },
  { code: "vwork_workplace", name: "Workplace", group: "vWork", app_code: null }
];

const CATEGORIES = [
  { code: "incident", name: "Lỗi / sự cố" },
  { code: "customer_account", name: "Hỗ trợ tài khoản khách" },
  { code: "transaction_interest", name: "Giao dịch & lãi" },
  { code: "customer_data_change", name: "Thay đổi thông tin khách" },
  { code: "internal_access", name: "Quyền & tài khoản nội bộ" },
  { code: "device_network", name: "Thiết bị & mạng" },
  { code: "feature_request", name: "Đề xuất tính năng" },
  { code: "question", name: "Hỏi đáp" },
  { code: "other", name: "Khác" }
];

type FieldType = "text" | "textarea" | "phone" | "number" | "money" | "date" | "select";
// appCodes: trường chỉ hiện / bắt buộc với sản phẩm có app_code tương ứng (rỗng = mọi sản phẩm).
const field = (
  key: string,
  label: string,
  type: FieldType,
  required = false,
  help = "",
  appCodes: string[] = []
) => ({
  key,
  label,
  type,
  required,
  placeholder: "",
  help,
  options: [],
  app_codes: appCodes
});
const doc = (kind: string, label: string, required = false, sensitive = false) => ({
  kind,
  label,
  required,
  sensitive
});

// Mã hồ sơ KHÔNG bắt buộc, hiện theo sản phẩm: TIKLUY → mã khoản đầu tư, VNFITE → mã khoản vay.
const RECORD_CODE_FIELDS = [
  field(
    "investment_code",
    "Mã khoản đầu tư",
    "text",
    false,
    "Mã khoản đầu tư (VNF + 13 số) khách thấy trên app TIKLUY, nếu liên quan.",
    ["tikluy"]
  ),
  field(
    "loan_code",
    "Mã khoản vay",
    "text",
    false,
    "Mã khoản vay / hồ sơ vay trên VNFITE, nếu liên quan.",
    ["vnfite"]
  )
];

// Hướng dẫn chung trước khi gửi ticket lỗi / hồ sơ vướng (tài liệu "Hướng dẫn gửi ticket hỗ trợ trên CRM").
const SELF_CHECK_GUIDANCE = [
  "Trước khi gửi, hãy tự kiểm tra: đã làm mới trang (F5) và đăng nhập lại chưa; đã chọn đúng hồ sơ và đúng bước của đơn vị mình chưa; việc cần làm có phải là một nút có sẵn trên hồ sơ không (Chờ bổ sung, Trả về, Đóng hồ sơ… tự cập nhật trạng thái và SLA — không dùng ticket cho các thao tác này).",
  "Không dùng ticket để xin ngoại lệ SLA hoặc điều chỉnh dữ liệu loại trừ SLA.",
  "Phần mô tả nên ghi: đang làm gì / bấm nút nào, kết quả mong đợi, kết quả thực tế (chép nguyên văn thông báo lỗi nếu có), thời điểm xảy ra. Trường hợp không có đủ các ý này thì ghi những gì bạn biết."
].join("\n");

// Tên trường dùng được trong title_pattern: {product}, {phone}, {name} và key của các trường bên dưới.
const TEMPLATES = [
  {
    code: "system_error",
    name: "Lỗi hệ thống (CRM báo lỗi, thao tác không chạy)",
    category: "incident",
    title_pattern: "[{product}] Lỗi hệ thống",
    fields: [...RECORD_CODE_FIELDS],
    required_documents: [doc("screenshot", "Ảnh chụp màn hình lỗi", true)],
    requires_approval: false,
    default_urgency: "high",
    guidance: SELF_CHECK_GUIDANCE
  },
  {
    code: "loan_file_stuck",
    name: "Hồ sơ vay đang xử lý bị vướng",
    category: "incident",
    title_pattern: "[{product}] Hồ sơ bị vướng",
    fields: [...RECORD_CODE_FIELDS],
    required_documents: [doc("screenshot", "Ảnh chụp màn hình", false)],
    requires_approval: false,
    default_urgency: "high",
    guidance: SELF_CHECK_GUIDANCE
  },
  {
    code: "forgot_password",
    name: "Quên mật khẩu / bị khoá đăng nhập",
    category: "customer_account",
    title_pattern: "[{product}] Quên mật khẩu – {phone}",
    fields: [field("reason", "Lý do khách không tự đặt lại được", "textarea", true)],
    required_documents: [],
    requires_approval: false,
    default_urgency: "high",
    guidance:
      "Khách có thể tự đặt lại mật khẩu trên app: Quên mật khẩu → nhập SĐT + số CCCD → nhập OTP. Chỉ tạo ticket khi khách làm không được."
  },
  {
    code: "reset_device",
    name: "Reset thiết bị",
    category: "customer_account",
    title_pattern: "[{product}] Reset thiết bị – {phone}",
    fields: [],
    required_documents: [doc("cccd_images", "CCCD 2 mặt", true, true)],
    requires_approval: false,
    default_urgency: "high",
    guidance:
      "VNFITE: khách tự reset trên app (SĐT + CCCD + ngày cấp + OTP). TIKLUY: chưa có tự reset, cần ticket kèm ảnh CCCD 2 mặt."
  },
  {
    code: "interest_not_credited",
    name: "Không cộng lãi / sai lãi",
    category: "transaction_interest",
    title_pattern: "[{product}] Không cộng lãi – {phone}",
    fields: [
      field(
        "investment_code",
        "Mã khoản đầu tư (VNF + 13 số) / mã khoản vay",
        "text",
        true,
        "Mã khách thấy trên app. Không phải số tài khoản VNF."
      ),
      field("product_name", "Sản phẩm đầu tư", "text"),
      field("expected_date", "Ngày dự kiến nhận lãi", "date"),
      field("expected_amount", "Số tiền dự kiến", "money")
    ],
    required_documents: [doc("screenshot", "Ảnh chụp màn hình")],
    requires_approval: false,
    default_urgency: "normal",
    guidance: ""
  },
  {
    code: "withdraw_deposit_stuck",
    name: "Rút / nạp tiền bị treo",
    category: "transaction_interest",
    title_pattern: "[{product}] Giao dịch bị treo – {phone}",
    fields: [
      field("amount", "Số tiền", "money", true),
      field("occurred_at", "Thời gian giao dịch", "date", true),
      field("bank", "Ngân hàng", "text"),
      field("transaction_code", "Mã giao dịch (nếu có)", "text")
    ],
    required_documents: [doc("transaction_proof", "Ảnh chuyển khoản / sao kê", false, true)],
    requires_approval: false,
    default_urgency: "high",
    guidance: ""
  },
  {
    code: "ekyc_unlock",
    name: "Mở khoá / làm lại eKYC",
    category: "customer_account",
    title_pattern: "[{product}] Làm lại eKYC – {phone}",
    fields: [field("reason", "Lý do", "textarea")],
    required_documents: [],
    requires_approval: false,
    default_urgency: "normal",
    guidance: ""
  },
  {
    code: "change_phone",
    name: "Đổi số điện thoại",
    category: "customer_data_change",
    title_pattern: "[{product}] Đổi SĐT {old_phone} → {new_phone}",
    fields: [
      field("old_phone", "SĐT cũ", "phone", true),
      field(
        "new_phone",
        "SĐT mới",
        "phone",
        true,
        "Kiểm tra SĐT mới chưa được đăng ký ở sản phẩm."
      ),
      field("id_number", "Số CCCD của khách", "text", true)
    ],
    required_documents: [
      doc("cccd_images", "CCCD 2 mặt", true, true),
      doc("sim_proof", "Bằng chứng chính chủ SIM", true, true)
    ],
    requires_approval: true,
    default_urgency: "normal",
    guidance:
      "Không có API đổi SĐT ở VNFITE/TIKLUY: IT phải sửa trực tiếp DB sản phẩm và cập nhật khách trong CRM vWork. Bắt buộc có tờ trình."
  },
  {
    code: "early_settlement_exception",
    name: "Tất toán trước hạn (ngoại lệ)",
    category: "transaction_interest",
    title_pattern: "[{product}] Tất toán trước hạn – {phone}",
    fields: [
      field("investment_code", "Mã khoản đầu tư", "text", true),
      field("exception_reason", "Lý do ngoại lệ", "textarea", true)
    ],
    required_documents: [],
    requires_approval: true,
    default_urgency: "normal",
    guidance:
      "TIKLUY cho tự tất toán trên app khi đã đủ 70% kỳ hạn. Chỉ tạo ticket khi cần xử lý ngoại lệ, kèm tờ trình."
  },
  {
    code: "rate_exception",
    name: "Tăng lãi / ngoại lệ về luồng, tiền",
    category: "transaction_interest",
    title_pattern: "[{product}] Ngoại lệ lãi – {phone}",
    fields: [
      field("investment_code", "Mã khoản đầu tư", "text", true),
      field("current_rate", "Lãi hiện tại (%)", "text"),
      field("proposed_rate", "Lãi đề xuất (%)", "text"),
      field("effective_date", "Ngày hiệu lực", "date"),
      field("legal_basis", "Căn cứ (số QĐ / quyết định)", "text", true)
    ],
    required_documents: [],
    requires_approval: true,
    default_urgency: "normal",
    guidance: ""
  }
];

async function seedProducts(): Promise<void> {
  for (const product of PRODUCTS) {
    const result = await TicketProductModel.updateOne(
      // Lọc theo mã KHÔNG kèm isDeleted: mục admin đã xoá (xoá mềm) không được tạo lại khi chạy lại seed
      { code: product.code },
      { $setOnInsert: { ...product, is_active: true } },
      { upsert: true }
    );
    console.log(
      result.upsertedCount
        ? `✅ Tạo sản phẩm: ${product.code}`
        : `⏭  Có sẵn (hoặc đã xoá, không tạo lại): ${product.code}`
    );
  }
}

async function seedCategories(): Promise<Map<string, unknown>> {
  const ids = new Map<string, unknown>();
  for (const category of CATEGORIES) {
    const result = await TicketCategoryModel.updateOne(
      { code: category.code },
      { $setOnInsert: { ...category, is_active: true } },
      { upsert: true }
    );
    console.log(
      result.upsertedCount
        ? `✅ Tạo loại yêu cầu: ${category.code}`
        : `⏭  Có sẵn (hoặc đã xoá, không tạo lại): ${category.code}`
    );
    const found = await TicketCategoryModel.findOne({ code: category.code, isDeleted: false })
      .select("_id")
      .lean();
    ids.set(category.code, found?._id);
  }
  return ids;
}

async function seedTemplates(categoryIds: Map<string, unknown>): Promise<void> {
  for (const template of TEMPLATES) {
    const { category, ...rest } = template;
    if (!categoryIds.get(category)) {
      console.log(`⏭  Bỏ qua mẫu ${template.code}: loại "${category}" đã bị xoá`);
      continue;
    }
    const result = await TicketTemplateModel.updateOne(
      { code: template.code },
      {
        $setOnInsert: {
          ...rest,
          category_id: categoryIds.get(category),
          is_active: true
        }
      },
      { upsert: true }
    );
    console.log(
      result.upsertedCount ? `✅ Tạo mẫu: ${template.code}` : `⏭  Có sẵn: ${template.code}`
    );
  }
}

// Cài đặt chung theo "Hướng dẫn gửi ticket hỗ trợ trên CRM" (chốt 30/10/2026). Chỉ áp dụng khi TẠO MỚI; cài
// đặt đã có thì chỉnh ở màn Cấu hình → Cài đặt chung (xem docs/TICKET-MODULE-PLAN.md mục 21).
//   - Ngày làm việc = 480 phút (8 giờ), T2–T6, không làm thứ 7.
//   - Ngưỡng "chưa ai nhận" = thời hạn phản hồi đầu tiên: Khẩn 30 phút · Cao 1 giờ · Bình thường 4 giờ · Thấp 1 ngày
//     (đơn vị: PHÚT LÀM VIỆC; phải tăng dần Khẩn ≤ Cao ≤ Bình thường ≤ Thấp).
const WORKDAY_MINUTES = 480;
const DEFAULT_SETTINGS = {
  key: "default",
  workday_minutes: WORKDAY_MINUTES,
  work_days: [1, 2, 3, 4, 5],
  day_windows: {},
  unclaimed_minutes: { urgent: 30, high: 60, normal: 240, low: WORKDAY_MINUTES },
  // Ngưỡng "im lặng" tính theo ngày làm việc của công ty (1 / 2 / 5 / 10 ngày). Không đặt thì Mongoose dùng mặc định
  // theo ngày 540 phút, làm "1 ngày im lặng" thành hơn 1 ngày với ngày 480 phút.
  silent_minutes: {
    urgent: WORKDAY_MINUTES,
    high: 2 * WORKDAY_MINUTES,
    normal: 5 * WORKDAY_MINUTES,
    low: 10 * WORKDAY_MINUTES
  }
};

async function seedSettings(): Promise<void> {
  const result = await TicketSettingModel.updateOne(
    { key: "default" },
    { $setOnInsert: DEFAULT_SETTINGS },
    { upsert: true }
  );
  console.log(
    result.upsertedCount
      ? "✅ Tạo cài đặt chung (ngưỡng phản hồi theo hướng dẫn, ngày làm việc 480 phút, T2–T6)"
      : "⏭  Có sẵn: cài đặt chung (chỉnh ở màn Cấu hình nếu cần)"
  );
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  await seedProducts();
  const categoryIds = await seedCategories();
  await seedTemplates(categoryIds);
  await seedSettings();

  console.log(
    "\n🎉 Hoàn thành seed ticket. Việc còn lại trên màn cấu hình: gán người phụ trách (handler) cho mẫu / loại yêu cầu / mặc định."
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
