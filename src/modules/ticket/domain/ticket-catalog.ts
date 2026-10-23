import { TicketResolutionCode } from "./types";
import { APPROVAL_DOCUMENT_ITEM_KEY } from "./ticket.entity";

// Danh mục cố định (không phải cấu hình theo công ty): checklist "yêu cầu bổ sung" và nhãn kết quả đóng.
// Frontend lấy qua GET /tickets/meta nên thêm mục mới chỉ cần sửa ở đây.

export interface InfoRequestCatalogItem {
  key: string;
  group: string;
  label: string;
}

export const OTHER_INFO_KEY = "other";

export const INFO_REQUEST_CATALOG: InfoRequestCatalogItem[] = [
  { key: "description", group: "Chung", label: "Mô tả rõ hơn" },
  { key: "screenshot", group: "Chung", label: "Ảnh/video chụp lỗi" },
  { key: "reproduce_steps", group: "Chung", label: "Các bước tái hiện lỗi" },

  { key: "customer_phone", group: "Khách hàng", label: "Số điện thoại khách" },
  { key: "customer_code", group: "Khách hàng", label: "Mã khách / userId" },
  { key: "customer_id_number", group: "Khách hàng", label: "Số CCCD của khách" },
  { key: "cccd_images", group: "Khách hàng", label: "CCCD 2 mặt" },
  {
    key: "customer_confirmation",
    group: "Khách hàng",
    label: "Xác nhận của khách (tin nhắn/ghi âm đồng ý)"
  },

  { key: "investment_code", group: "Tài chính", label: "Mã khoản đầu tư / khoản vay" },
  {
    key: "transaction_proof",
    group: "Tài chính",
    label: "Chứng từ (sao kê, UNC, ảnh chuyển khoản, mã giao dịch)"
  },
  { key: "amount_and_time", group: "Tài chính", label: "Số tiền và thời điểm" },
  { key: "legal_basis", group: "Tài chính", label: "Căn cứ áp dụng (số QĐ, chính sách)" },

  { key: APPROVAL_DOCUMENT_ITEM_KEY, group: "Phê duyệt", label: "Tờ trình có chữ ký" },

  { key: OTHER_INFO_KEY, group: "Khác", label: "Khác (ghi rõ)" }
];

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
  APPROVAL_DOCUMENT_ITEM_KEY
];
