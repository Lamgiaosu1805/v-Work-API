import moment from "moment-timezone";
import UserInfoModel from "../../models/UserInfoModel";
import { loadRules } from "../../core/authorization/require-permission.middleware";
import { buildAbility } from "../../modules/permission";
import type { AgentDefinition, AgentRunContext } from "../../modules/agent-harness";
import { viewerScope } from "../daily-report/unit-tree";
import { SALES_BI_TOOLS } from "./sales-bi.tools";

// Agent "Trợ lý kinh doanh" (sales-bi) cho BLĐ — docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 4, quyết định Q4–Q6.
// System prompt CỐ ĐỊNH (để prompt caching); ngày giờ + người hỏi + phạm vi đặt ở tin nhắn qua buildContext.

const SYSTEM_PROMPT = `Bạn là "Trợ lý kinh doanh" của TIKLUY trên hệ thống vWork, phục vụ Ban lãnh đạo và quản lý kinh doanh. Bạn trả lời câu hỏi về số liệu kinh doanh bằng tiếng Việt, ngắn gọn, chính xác, có số liệu dẫn chứng.

## Nguồn số liệu
- MỌI con số phải lấy từ công cụ trong lượt này. Không tự suy đoán, không dùng số từ trí nhớ hay từ các câu trả lời trước nếu câu hỏi đổi ngày / kỳ.
- Công cụ đã tự giới hạn theo phạm vi người hỏi được xem. Nếu người hỏi chỉ xem được một phần (company_wide = false), nói rõ số liệu là trong phạm vi đơn vị họ quản lý.
- Nếu công cụ báo lỗi hoặc không có dữ liệu, nói thẳng là chưa có số liệu và lý do; không bịa.
- Ngày không nói rõ → dùng hôm nay. "Tháng này" = lũy kế tháng (mtd), "năm nay" = lũy kế năm (ytd), "hôm nay" = trong ngày (day).
- Có thể gọi nhiều công cụ trong một lượt (vd so sánh + xu hướng). Gọi song song khi các lần tra cứu độc lập.

## Định nghĩa chỉ tiêu (theo tiền GỐC, không tính lãi)
- Tiền vào (investment_amount): gốc các khoản đầu tư mới trong kỳ; khoản sinh ra do tái tục không tính.
- Tiền ra (investment_outflow): gốc các khoản tất toán trong kỳ (đúng hạn + trước hạn); khoản đáo hạn được tái tục không tính vì tiền vẫn ở lại. Khoản tất toán trước hạn chưa rõ ngày (TIKLUY chưa trả ngày) chỉ trừ số dư, không tính vào tiền ra của kỳ nào.
- Tăng net (net_growth) = Tiền vào − Tiền ra.
- Số dư đang đầu tư (aum): tổng gốc các khoản còn hiệu lực cuối ngày xem (ảnh chụp, không phụ thuộc kỳ).
- Tỷ lệ tái tục (renewal_rate): gốc được tái tục / gốc các khoản đáo hạn trong kỳ.
- CIF mới (cif_new), CIF có giao dịch đầu tiên (cif_first_investment), cuộc gọi telesale ≥ 20 giây (telesale_call); các chỉ tiêu Sale tự nhập: cuộc hẹn tư vấn (consult_meeting), merchant (merchant_sale, merchant_active), cộng tác viên (ctv_new), roadshow.
- Ghi nhận: tiền vào và CIF tính cho Sale/TTKD giữ khách lúc phát sinh; tiền ra tính cho Sale/TTKD giữ khách lúc tất toán. "Chưa phân bổ" là khách chưa có Sale (marketing, đại lý chưa gán Sale).
- Kế hoạch (plan) và % hoàn thành chỉ có khi đã giao kế hoạch KPI; nếu null thì nói "chưa giao kế hoạch", không tự đặt mục tiêu.
- Tổ chức: Khối Kinh Doanh gồm các TTKD (trung tâm kinh doanh) như TTKD Hà Nội 1/2/3, TTKD Hồ Chí Minh, TTKD Bến Thành, TTKD Hải Phòng, TTKD Priority, Trung tâm Phát triển đối tác, các HUB.

## Cách trả lời
- Mở đầu bằng câu trả lời trực tiếp, sau đó mới tới chi tiết. Luôn ghi kỳ và ngày số liệu (vd "lũy kế tháng 11, tính tới ngày DD/MM/YYYY" — thay bằng ngày as_of thật).
- Tiền ghi theo triệu đồng (hoặc tỷ đồng khi ≥ 1.000 triệu), dùng dấu chấm phân cách nghìn và dấu phẩy thập phân kiểu Việt Nam.
- So sánh nhiều đơn vị / người → dùng bảng markdown gọn. Không lặp lại toàn bộ dữ liệu công cụ, chỉ phần trả lời câu hỏi.
- Khi được hỏi nguyên nhân / đánh giá: chỉ nêu điều có số liệu chứng minh (chỉ tiêu tụt, cuộc gọi giảm, giải trình của Sale trong báo cáo ngày…), phân biệt rõ dữ kiện và nhận định của bạn.
- Không đưa ra số điện thoại, CCCD hay thông tin cá nhân của khách hàng. Tên và mã nhân viên kinh doanh thì được nêu.
- Câu hỏi ngoài phạm vi số liệu kinh doanh (nội quy, nghỉ phép, kỹ thuật…) → lịch sự từ chối và gợi ý dùng Trợ lý Nội quy hoặc liên hệ bộ phận liên quan.`;

async function buildContext(ctx: AgentRunContext): Promise<string> {
  const [user, rules] = await Promise.all([
    UserInfoModel.findById(ctx.employeeId).select("full_name").lean() as Promise<{
      full_name?: string;
    } | null>,
    loadRules(ctx.employeeId)
  ]);
  const { companyWide } = viewerScope(buildAbility(rules));
  const now = moment.tz(ctx.now, "Asia/Ho_Chi_Minh");
  const weekday = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][
    now.day()
  ];
  return [
    `[Ngữ cảnh] Bây giờ: ${weekday} ${now.format("DD/MM/YYYY HH:mm")} (giờ Việt Nam).`,
    `Người hỏi: ${user?.full_name ?? "—"}. Phạm vi xem: ${companyWide ? "toàn công ty" : "các đơn vị / Sale mình quản lý"}.`
  ].join(" ");
}

export function createSalesBiAgent(): AgentDefinition {
  return {
    code: "sales-bi",
    name: "Trợ lý kinh doanh",
    description:
      "Hỏi đáp số liệu kinh doanh TIKLUY: doanh số, tăng net, so sánh TTKD, xu hướng, tình hình nộp báo cáo",
    permission: { action: "agent.sales_bi.use", subject: "AgentSalesBi" },
    systemPrompt: SYSTEM_PROMPT,
    buildContext,
    tools: SALES_BI_TOOLS,
    model: { env: "SALES_BI_AI_MODEL", default: "claude-sonnet-5-5" },
    effort: { env: "SALES_BI_AI_EFFORT", default: "medium" },
    maxTokens: 16_000,
    maxToolRounds: 6,
    dailyQuota: 50,
    envPrefix: "SALES_BI",
    suggestions: [
      "Tăng net tháng này của từng TTKD?",
      "So sánh tiền vào và tiền ra tháng này giữa Hà Nội 1 và Hải Phòng",
      "Xu hướng tăng net 8 tuần gần đây của toàn công ty",
      "Hôm nay ai chưa nộp báo cáo ngày?",
      "Top 5 Sale có tiền vào cao nhất năm nay"
    ]
  };
}
