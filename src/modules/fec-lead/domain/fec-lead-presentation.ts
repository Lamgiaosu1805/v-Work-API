import { FecLeadStage } from "./types";

// Cách trình bày lead FE Credit cho người dùng CRM: nhãn bước, giai đoạn và gợi ý cho Sale.
// Thuần (không đụng Mongoose) để dùng chung cho màn hình, hộp thoại chi tiết và file Excel — một nguồn duy nhất.

export const FEC_STAGE_LABELS: Record<FecLeadStage, string> = {
  FOLLOW_UP: "Cần tư vấn",
  IN_PROGRESS: "Đang thực hiện",
  COMPLETED: "Hoàn tất",
  STOPPED: "Không tiếp tục được",
  REJECTED_AT_START: "Bị loại ngay từ đầu"
};

// Nhãn trạng thái callback FE Credit (khoá là trạng thái thô, viết thường)
const STEP_LABELS: Record<string, string> = {
  "app download": "Đã tải app FE Credit",
  "start registration": "Đang đăng ký tài khoản FE Credit",
  "app login": "Đã đăng nhập app FE Credit",
  "pre-screening failure": "Không đạt sơ tuyển",
  "referral code": "Đã ghi nhận mã giới thiệu",
  "start loan onboarding": "Đang làm hồ sơ",
  "pending esign": "Chờ ký điện tử",
  "pending offer": "Chờ khách xác nhận đề nghị",
  "pending disbursement": "Chờ giải ngân",
  "pl disbursed": "Đã giải ngân",
  "hard reject": "FE Credit từ chối",
  "soft reject": "Chưa đủ điều kiện lúc này",
  cancellation: "Đã huỷ hồ sơ",
  "drop-off": "Dừng thao tác"
};

export interface FecLeadStepInfo {
  stage: FecLeadStage;
  last_step?: string | null;
  stop_reason?: string | null;
}

export function stepLabel(status?: string | null): string {
  if (!status) return "Chưa mở app FE Credit";
  return STEP_LABELS[status.trim().toLowerCase()] ?? status;
}

// Nhóm "không tiếp tục được" thì cho biết lý do dừng thay vì bước cuối
export function currentStepLabel(lead: FecLeadStepInfo): string {
  return lead.stage === "STOPPED" ? stepLabel(lead.stop_reason) : stepLabel(lead.last_step);
}

// Gợi ý một dòng cho Sale, dựa trên bước khách đang dừng
export function adviceFor(lead: FecLeadStepInfo): string {
  switch (lead.stage) {
    case "REJECTED_AT_START":
      return "FE Credit không nhận hồ sơ ngay từ đầu.";
    case "COMPLETED":
      return "Đã giải ngân.";
    case "IN_PROGRESS":
      return "Khách đang thao tác — theo dõi thêm.";
    case "STOPPED":
      switch ((lead.stop_reason ?? "").toLowerCase()) {
        case "soft reject":
          return "Chưa đủ điều kiện lúc này — có thể tư vấn đăng ký lại sau.";
        case "cancellation":
          return "Hồ sơ đã bị huỷ.";
        case "pre-screening failure":
          return "Không đạt sơ tuyển của FE Credit — không tiếp tục được.";
        default:
          return "FE Credit từ chối — không tiếp tục được.";
      }
    default:
      switch ((lead.last_step ?? "").toLowerCase()) {
        case "":
          return "Chưa mở app — gọi nhắc bấm link và tải app FE Credit.";
        case "app download":
          return "Đã tải app nhưng chưa đăng ký — gọi hướng dẫn đăng ký tài khoản.";
        case "start registration":
          return "Dừng lúc đăng ký — gọi hỗ trợ hoàn tất đăng ký.";
        case "app login":
          return "Đã đăng nhập rồi dừng — hỏi lý do và hướng dẫn làm hồ sơ.";
        case "referral code":
        case "start loan onboarding":
          return "Dừng khi làm hồ sơ — gọi hỗ trợ hoàn tất hồ sơ.";
        case "pending esign":
          return "Chưa ký điện tử — gọi nhắc ký.";
        case "pending offer":
          return "Chưa xác nhận đề nghị — tư vấn đề nghị và nhắc xác nhận.";
        case "pending disbursement":
          return "Đang chờ giải ngân — theo dõi, chưa cần gọi.";
        default:
          return "Gọi hỏi khách đang vướng ở bước nào.";
      }
  }
}
