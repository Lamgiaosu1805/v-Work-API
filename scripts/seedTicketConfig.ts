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
  { code: "vnfite_app", name: "VNFITE APP", group: "VNFITE", app_code: "vnfite", sort_order: 10 },
  { code: "vnfite_cms", name: "VNFITE CMS", group: "VNFITE", app_code: "vnfite", sort_order: 20 },
  { code: "tikluy_app", name: "TIKLUY APP", group: "TIKLUY", app_code: "tikluy", sort_order: 30 },
  { code: "tikluy_cms", name: "TIKLUY CMS", group: "TIKLUY", app_code: "tikluy", sort_order: 40 },
  { code: "vwork_crm", name: "CRM", group: "vWork", app_code: null, sort_order: 50 },
  { code: "vwork_hrm", name: "HRM", group: "vWork", app_code: null, sort_order: 60 },
  { code: "vwork_workplace", name: "Workplace", group: "vWork", app_code: null, sort_order: 70 }
];

const CATEGORIES = [
  { code: "incident", name: "Lỗi / sự cố", sort_order: 10 },
  { code: "customer_account", name: "Hỗ trợ tài khoản khách", sort_order: 20 },
  { code: "transaction_interest", name: "Giao dịch & lãi", sort_order: 30 },
  { code: "customer_data_change", name: "Thay đổi thông tin khách", sort_order: 40 },
  { code: "internal_access", name: "Quyền & tài khoản nội bộ", sort_order: 50 },
  { code: "device_network", name: "Thiết bị & mạng", sort_order: 60 },
  { code: "feature_request", name: "Đề xuất tính năng", sort_order: 70 },
  { code: "question", name: "Hỏi đáp", sort_order: 80 },
  { code: "other", name: "Khác", sort_order: 90 }
];

type FieldType = "text" | "textarea" | "phone" | "number" | "money" | "date" | "select";
const field = (key: string, label: string, type: FieldType, required = false, help = "") => ({
  key,
  label,
  type,
  required,
  placeholder: "",
  help,
  options: []
});
const doc = (kind: string, label: string, required = false, sensitive = false) => ({
  kind,
  label,
  required,
  sensitive
});

// Tên trường dùng được trong title_pattern: {product}, {phone}, {name} và key của các trường bên dưới.
const TEMPLATES = [
  {
    code: "forgot_password",
    name: "Quên mật khẩu / bị khoá đăng nhập",
    category: "customer_account",
    title_pattern: "[{product}] Quên mật khẩu – {phone}",
    fields: [field("reason", "Lý do khách không tự đặt lại được", "textarea", true)],
    required_documents: [],
    requires_approval: false,
    default_urgency: "urgent",
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
    default_urgency: "urgent",
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
    default_urgency: "urgent",
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
      { code: product.code, isDeleted: false },
      { $setOnInsert: { ...product, is_active: true } },
      { upsert: true }
    );
    console.log(
      result.upsertedCount ? `✅ Tạo sản phẩm: ${product.code}` : `⏭  Có sẵn: ${product.code}`
    );
  }
}

async function seedCategories(): Promise<Map<string, unknown>> {
  const ids = new Map<string, unknown>();
  for (const category of CATEGORIES) {
    const result = await TicketCategoryModel.updateOne(
      { code: category.code, isDeleted: false },
      { $setOnInsert: { ...category, is_active: true } },
      { upsert: true }
    );
    console.log(
      result.upsertedCount
        ? `✅ Tạo loại yêu cầu: ${category.code}`
        : `⏭  Có sẵn: ${category.code}`
    );
    const found = await TicketCategoryModel.findOne({ code: category.code, isDeleted: false })
      .select("_id")
      .lean();
    ids.set(category.code, found?._id);
  }
  return ids;
}

async function seedTemplates(categoryIds: Map<string, unknown>): Promise<void> {
  for (const [index, template] of TEMPLATES.entries()) {
    const { category, ...rest } = template;
    const result = await TicketTemplateModel.updateOne(
      { code: template.code, isDeleted: false },
      {
        $setOnInsert: {
          ...rest,
          category_id: categoryIds.get(category),
          is_active: true,
          sort_order: (index + 1) * 10
        }
      },
      { upsert: true }
    );
    console.log(
      result.upsertedCount ? `✅ Tạo mẫu: ${template.code}` : `⏭  Có sẵn: ${template.code}`
    );
  }
}

async function seedSettings(): Promise<void> {
  const result = await TicketSettingModel.updateOne(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { upsert: true }
  );
  console.log(
    result.upsertedCount ? "✅ Tạo cài đặt chung (giá trị mặc định)" : "⏭  Có sẵn: cài đặt chung"
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
