import { TicketResolutionCode, TicketUrgency } from "./types";
import { APPROVAL_DOCUMENT_ITEM_KEY } from "./ticket.entity";

// Danh mục cố định (không phải cấu hình theo công ty): checklist "yêu cầu bổ sung" và nhãn kết quả đóng.
// Frontend lấy qua GET /tickets/meta nên thêm mục mới chỉ cần sửa ở đây.

// `input`: người tạo đáp lại bằng gì — "text" (phải nhập nội dung), "file" (đính kèm), "either" (nhập hoặc
// đính kèm đều được). Hộp thoại "Bổ sung thông tin" dựa vào đây để bắt nhập nội dung khi cần.
export type InfoRequestInput = "text" | "file" | "either";

export interface InfoRequestCatalogItem {
  key: string;
  group: string;
  label: string;
  input: InfoRequestInput;
}

export const OTHER_INFO_KEY = "other";

export const INFO_REQUEST_CATALOG: InfoRequestCatalogItem[] = [
  { key: "description", group: "Chung", label: "Mô tả rõ hơn", input: "text" },
  { key: "screenshot", group: "Chung", label: "Ảnh/video chụp lỗi", input: "file" },
  { key: "reproduce_steps", group: "Chung", label: "Các bước tái hiện lỗi", input: "text" },

  { key: "customer_phone", group: "Khách hàng", label: "Số điện thoại khách", input: "text" },
  { key: "customer_id_number", group: "Khách hàng", label: "Số CCCD của khách", input: "text" },
  { key: "cccd_images", group: "Khách hàng", label: "CCCD 2 mặt", input: "file" },
  {
    key: "customer_confirmation",
    group: "Khách hàng",
    label: "Xác nhận của khách (tin nhắn/ghi âm đồng ý)",
    input: "either"
  },

  {
    key: "investment_code",
    group: "Tài chính",
    label: "Mã khoản đầu tư / khoản vay",
    input: "text"
  },
  {
    key: "transaction_proof",
    group: "Tài chính",
    label: "Chứng từ (sao kê, UNC, ảnh chuyển khoản, mã giao dịch)",
    input: "either"
  },
  { key: "amount_and_time", group: "Tài chính", label: "Số tiền và thời điểm", input: "text" },
  {
    key: "legal_basis",
    group: "Tài chính",
    label: "Căn cứ áp dụng (số QĐ, chính sách)",
    input: "text"
  },

  {
    key: APPROVAL_DOCUMENT_ITEM_KEY,
    group: "Phê duyệt",
    label: "Tờ trình có chữ ký",
    input: "file"
  },

  { key: OTHER_INFO_KEY, group: "Khác", label: "Khác (ghi rõ)", input: "either" }
];

export const URGENCY_LABELS: Record<TicketUrgency, string> = {
  urgent: "Khẩn",
  high: "Cao",
  normal: "Bình thường",
  low: "Thấp"
};

export const RESOLUTION_LABELS: Record<TicketResolutionCode, string> = {
  solved: "Đã giải quyết",
  wont_fix: "Không giải quyết",
  insufficient_basis: "Chưa đủ cơ sở",
  not_a_bug: "Không phải lỗi",
  duplicate: "Trùng",
  requester_no_response: "Người tạo không bổ sung"
};

// Loại file mặc định coi là nhạy cảm (CCCD, chứng từ tài chính, tờ trình) — mẫu yêu cầu có thể đánh
// dấu thêm theo từng giấy tờ.
export const DEFAULT_SENSITIVE_KINDS = [
  "cccd",
  "cccd_images",
  "transaction_proof",
  // Giấy tờ cá nhân khác do người gửi tự đánh dấu nhạy cảm trong khung trao đổi
  "sensitive_other",
  APPROVAL_DOCUMENT_ITEM_KEY
];
