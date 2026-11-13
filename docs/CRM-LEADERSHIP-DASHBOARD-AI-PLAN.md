# Bảng điều hành BLĐ (doanh số, tăng net, so sánh TTKD) + Trợ lý AI kinh doanh + Agent harness phòng ban

> Trạng thái: **A + B ĐÃ CODE (13/11/2026)** trên nhánh `feat/crm-leadership-dashboard` (API + web) — xem mục 8.
> C (AI + harness) làm sau đợt test. Phần B chạy theo giả định, còn chờ TIKLUY xác nhận 4 điểm ở mục 3.3.
> Nối tiếp: `CRM-DAILY-REPORT-FLOWS.md` (báo cáo ngày, ghi nhận KPI — PR #179/#181), `HANDBOOK-ASSISTANT.md` (trợ lý nội quy).
> Phạm vi: TIKLUY.

## 0. Trả lời nhanh

| Yêu cầu | Làm được? | Điều kiện |
|---|---|---|
| BLĐ xem doanh số theo ngày / lũy kế tháng / năm | **Có — đã có** ở màn Tổng hợp báo cáo ngày (PR #104) | — |
| So sánh giữa các TTKD (xếp hạng, xu hướng theo tuần/tháng) | **Có** | Thêm 1 API chuỗi thời gian + màn "So sánh TTKD" |
| Tăng net (tiền vào − tiền ra) | **Có** | vWork chưa có dữ liệu tất toán → đồng bộ từ API danh mục đầu tư sẵn có của TIKLUY; cần TIKLUY xác nhận ý nghĩa vài trường (mục 3.3) |
| BLĐ hỏi AI bằng tiếng Việt | **Có** | Dựng trên khung của trợ lý nội quy (socket stream, hạn mức, chi phí, watchdog) + thêm gọi công cụ (tool use) đọc số KPI |
| Agent harness cho từng phòng ban | **Có, làm theo bước** | Tách lõi harness dùng chung; mỗi phòng ban = 1 cấu hình agent + bộ công cụ riêng |

## 1. Đã có sẵn để dùng lại

| Thành phần | Ở đâu | Dùng cho |
|---|---|---|
| Ghi nhận KPI bất biến (`kpi_attribution`, `kpi_cif`), bảng tổng hợp theo cây TTKD | PR #179 / #181, `workflows/daily-report-board.workflow.ts` | Doanh số, CIF theo TTKD; nguồn số cho AI |
| API TIKLUY danh mục đầu tư theo khách `GET /user-investment-holding/crm/{external_id}` (lọc `type`, `fromDate`, `toDate`) | `CustomerController.getCustomerInvestmentHolding` | Trả về hợp đồng: `investmentCode`, `investAmount`, `startDate`, `endDate`, `status` (0 đang đầu tư / 1 tất toán trước hạn / 2 đã tất toán), `totalProfit`, `formOfMaturity` → **nguồn tiền ra + tái tục** |
| API TIKLUY biến động số dư theo khách `/user/fluctuation/crm/alls` | `CustomerController.getFluctuation` | Sổ vào/ra ví (`fluctuatedAmount`, `plus`, `createdDate`) — dự phòng đối soát |
| Trợ lý nội quy: socket stream (`start/delta/done/error`), hội thoại, hạn mức, khoá chống trùng, watchdog, ghi chi phí, xoá theo hạn, prompt caching, cổng `HandbookAnswerer` | `modules/handbook-assistant`, web `features/ai-assistant` | Khung cho trợ lý kinh doanh và harness phòng ban |
| `AiController.chat` (CRM, Haiku 4.5, 3 tool) | `controllers/AiController.js` | Không dùng lại — vòng lặp tool lỗi, không stream (xem `CRM-DAILY-SALES-REPORT-PLAN.md` mục 4.6) |

## 2. So sánh TTKD & xu hướng

- **API mới** `GET /daily-reports/trend?metric=&granularity=week|month&from=&to=&level=branch|ttkd` → chuỗi số theo đơn vị
  (dùng lại registry `auto-metric-sources`, gom theo kỳ). Quyền `daily_report.view`, phạm vi như bảng tổng hợp.
- **Màn "So sánh TTKD"** (tab mới trong Tổng hợp báo cáo ngày hoặc màn riêng "Bảng điều hành"):
  - Xếp hạng TTKD theo chỉ tiêu chọn (cột ngang): TH, % HT kế hoạch, bình quân/Sale.
  - Xu hướng theo tuần/tháng (đường) cho các TTKD chọn; so cùng kỳ tháng trước.
  - Heatmap TTKD × chỉ tiêu theo % HT so với tiến độ thời gian.

## 3. Tăng net

### 3.1 Định nghĩa (đã chốt — Q1, Q2)
- Tiền vào = gốc các khoản đầu tư mới (đã có, `kpi_attribution`).
- Tiền ra = **gốc** các khoản **tất toán** (đúng hạn + trước hạn) trong kỳ — không tính lãi.
- **Tái tục không tính** là ra rồi vào lại (khoản tái tục không cộng tiền vào, khoản gốc tái tục không cộng tiền ra).
- **Tăng net = Tiền vào − Tiền ra**; thêm chỉ tiêu **Số dư đang đầu tư (AUM)** cuối kỳ.
- Tiền ra **trừ vào Sale đang giữ khách lúc tất toán** và TTKD của Sale đó lúc ấy (khớp cách tính tiền vào). Chụp vào
  `closure_attribution` của khoản đầu tư khi đồng bộ được tất toán; dữ liệu cũ (backfill) dùng Sale đang giữ hiện tại.

### 3.2 Dữ liệu
- `InvestmentModel` thêm: `closed_at`, `closed_principal`, `closed_profit`, `close_type` (`matured` / `early` / `renewed`),
  `renewed_to_investment_id`, `last_synced_at`.
- Job đêm `syncInvestmentClosures` (01:30): lấy khách có khoản `active` đã tới hạn hoặc sắp tới hạn / mọi khách đang đầu tư →
  gọi API danh mục đầu tư TIKLUY → cập nhật trạng thái + ngày/tiền tất toán theo `investmentCode` ↔ `external_investment_id`.
  Giới hạn đồng thời + nghỉ giữa các lượt; ghi log đồng bộ. Chạy backfill 1 lần cho năm 2026.
- Tiền ra ghi nhận cho Sale/TTKD theo Q2; chỉ tiêu mới trong registry: `investment_outflow`, `net_growth`, `aum`.
- **Mở khoá luôn "Tỷ lệ tái tục" (Priority 20%)** = tiền tái tục / tiền đáo hạn trong kỳ.
- Song song đề nghị TIKLUY gửi sự kiện tất toán/tái tục realtime (có retry) — khi có thì job đêm chỉ còn là lưới đối soát.

### 3.3 Cần TIKLUY xác nhận
1. `investmentCode` có trùng `external_investment_id` đang đẩy sang `/investments/upsert` không?
2. `endDate` với khoản tất toán trước hạn là ngày tất toán thật hay ngày đáo hạn theo hợp đồng?
3. `formOfMaturity` có những giá trị nào (tự tái tục gốc / gốc + lãi / chuyển về ví)? Khoản tái tục có tạo hợp đồng mới không?
4. `fromDate`/`toDate` lọc theo ngày nào; API có chịu được ~vài nghìn lượt gọi mỗi đêm không (hoặc có API lấy theo khoảng ngày cho mọi khách)?

## 4. Trợ lý AI kinh doanh cho BLĐ

- **Hỏi đáp số liệu**: "Hôm nay TTKD nào chưa nộp báo cáo?", "Tăng net tuần này của HN1 so với HN2?", "Ai đang chậm tiến độ nhất?".
- **Phân tích**: chỉ ra chỉ tiêu tụt + nguyên nhân có số liệu (cuộc gọi giảm, tỷ lệ eKYC → đầu tư, giải trình của Sale) + đề xuất.
- **Công cụ (chỉ đọc, gọi đúng hàm của bảng tổng hợp, tự áp phạm vi quyền người hỏi)**: `find_units_or_people`, `get_scorecard`,
  `get_submission_status`, `compare_units`, `get_trend`, `rank`, `get_daily_report_notes`, `get_net_flow`.
  Kết quả tool là số tổng hợp có đơn vị + mốc `as_of`; không trả SĐT/CCCD khách.
- **Người dùng (Q5)**: quyền riêng `agent.sales_bi.use`, đợt đầu chỉ cấp cho BLĐ, sau mở GĐ chi nhánh / QL TTKD. AI chỉ đọc
  số trong phạm vi `daily_report.view` của chính người hỏi.
- **Model (Q4)**: `claude-sonnet-5-5` (~0,04–0,06 USD/câu, ~80–120 USD/tháng với ~10 người × 10 câu/ngày), cấu hình qua env
  `SALES_BI_AI_MODEL` / `SALES_BI_AI_EFFORT` để đổi khi cần.
- **Kỹ thuật**: Claude API qua `@anthropic-ai/sdk`, tool use với schema `strict`, `tool_choice: auto`, thinking adaptive +
  `effort`, stream qua socket như trợ lý nội quy, prompt caching cho system + tools (ngày giờ đặt ở tin nhắn,
  không ở system), giới hạn số lượt gọi tool / câu, ghi `usage` + chi phí mỗi câu, xử lý `stop_reason: refusal`.
- **Đánh giá**: bộ 30–50 câu hỏi thật của BLĐ + đáp án tính từ bảng tổng hợp; chạy lại mỗi lần đổi prompt/tool/model.

## 5. Agent harness cho phòng ban

```
modules/agent-harness/            # lõi dùng chung — tách từ khung trợ lý nội quy
  hội thoại + tin nhắn (agent_code), hạn mức, khoá chống trùng, watchdog, ghi chi phí, xoá theo hạn,
  socket `agent:ask/start/delta/tool/done/error/cancel`, vòng lặp tool có giới hạn, nhật ký truy xuất
agents/
  sales-bi        → Trợ lý kinh doanh (BLĐ, GĐ chi nhánh, QL TTKD) — công cụ KPI/báo cáo ngày
  handbook        → Trợ lý nội quy (chuyển sang harness sau, giữ hợp đồng web hiện tại)
  hrm / accounting / cskh … → thêm dần: mỗi agent = { system prompt, bộ tool, model/effort, quyền, hạn mức }
```

- Quyền theo agent: `agent.<code>.use`; dữ liệu trả về luôn qua tool đã áp phạm vi quyền của người hỏi.
- Web: dùng lại khung chat của `features/ai-assistant` (launcher + panel), thêm chọn agent theo quyền.

## 6. Lộ trình đề xuất (1 dev + Claude)

| Bước | Nội dung | Ước lượng | Khi nào (Q7) |
|---|---|---|---|
| A | So sánh TTKD + xu hướng (API + web) | 1–1,5 ngày | **Trước đợt test** |
| B | Tăng net: đồng bộ tất toán từ TIKLUY, chỉ tiêu `investment_outflow` / `net_growth` / `aum` / tái tục, backfill | 1,5–2 ngày (+ chờ TIKLUY xác nhận mục 3.3) | **Trước đợt test** |
| C | Lõi agent harness + agent `sales-bi` + màn chat web + bộ câu hỏi đánh giá | 4–5 ngày | Sau đợt test |
| D | Chuyển trợ lý nội quy sang harness; agent phòng ban tiếp theo | — | Sau |

A + B làm trên nhánh mới tách từ `feat/crm-daily-report` (PR #179/#181/#104 chưa merge) — merge theo đúng thứ tự.

## 7. Bảng quyết định (đã chốt 13/11/2026)

| # | Câu hỏi | Chốt |
|---|---|---|
| Q1 | Định nghĩa tăng net | Vào − ra theo **gốc**; tái tục không tính là ra + vào |
| Q2 | Tiền ra trừ vào Sale/TTKD nào | **Sale đang giữ khách lúc tất toán** (+ TTKD của Sale lúc đó) |
| Q3 | Nguồn dữ liệu tiền ra | **vWork tự đồng bộ hằng đêm** qua API danh mục đầu tư TIKLUY (có backfill); song song đề nghị TIKLUY gửi sự kiện realtime |
| Q4 | Model AI cho trợ lý kinh doanh | **Claude Sonnet 5.5** (đổi được qua env) |
| Q5 | Ai được dùng trợ lý kinh doanh | **BLĐ trước** (`agent.sales_bi.use`), mở dần GĐ chi nhánh / QL TTKD; dữ liệu theo phạm vi của người hỏi |
| Q6 | Kiến trúc | **Lõi agent harness chung ngay**, trợ lý KD là agent đầu; trợ lý nội quy giữ nguyên, chuyển sau |
| Q7 | Thứ tự | **So sánh TTKD + tăng net trước đợt test**, AI sau |

## 8. Đã triển khai A + B (13/11/2026)

### 8.1 API

| Thành phần | File | Ghi chú |
|---|---|---|
| Trường ghi nhận tất toán | `src/models/InvestmentModel.js` | `closure` (type matured/early_terminated, closed_at, principal, profit, form_of_maturity, renewed, synced_at), `closure_attribution` (Sale/TTKD đang giữ khách lúc đồng bộ — Q2), `renewal_of` (khoản sinh ra do tái tục), `holding_synced_at`. Index `app_id + closure.closed_at` |
| Gọi danh mục TIKLUY | `src/utils/tikluyClient.js` → `getInvestmentHoldings(externalId, { pageNumber, pageSize, type })` | `GET /user-investment-holding/crm/{external_id}` |
| Ánh xạ dòng TIKLUY | `src/workflows/investment-closure/holding-mapper.ts` | Khớp theo `id` của TIKLUY (= `external_investment_id`; `investmentCode` chỉ là mã hiển thị VNF…); ngày dạng `HH:mm DD/MM/YYYY`; status 1 tất toán trước hạn / 2 đã tất toán; trước hạn: `endDate` (ngày đáo hạn hợp đồng) nếu đã qua, chưa tới thì lấy lúc phát hiện; tái tục = đáo hạn + `formOfMaturity` "Chuyển gốc (và lãi) sang kỳ hạn mới" / "Tái tục…"; khoản tái tục = khoản mới cùng khách trong ±2 ngày, tiền ≥ 99% gốc, ưu tiên tiền sát gốc + lãi nhất |
| Đồng bộ | `src/workflows/investment-closure-sync.workflow.ts` | Chỉ hỏi khách còn khoản chưa ghi nhận tất toán; **không đổi `status` / hoa hồng**; chạy lại không ghi trùng; chuỗi tái tục đã đáo hạn hết (chạy bù) vẫn nối đúng từng khoản |
| Cron | `src/jobs/investmentClosureSyncJob.js` | 01:30 hằng đêm, khoá Redis có tiền tố môi trường, app `tikluy` |
| Chạy bù / chạy tay | `scripts/syncInvestmentClosures.ts --app=tikluy [--dry-run] [--limit=N] [--concurrency=3]` | Chạy `--dry-run` trước (vẫn gọi TIKLUY, không ghi DB) |
| Tất toán trước hạn không rõ ngày | `closure.date_unknown`; sửa dữ liệu lần đồng bộ đầu: `scripts/markUnknownEarlyTerminations.ts --app=tikluy --synced-on=YYYY-MM-DD [--dry-run]` | TIKLUY không trả ngày tất toán trước hạn. Khoản phát hiện ở lần đồng bộ ĐẦU mà hợp đồng chưa đáo hạn → không rõ ngày: không tính tiền ra theo kỳ, vẫn trừ số dư. Từ lần sau (đã từng thấy còn mở) → ngày phát hiện là ngày thật (sai số ≤ 1 ngày) |
| Chỉ tiêu mới | `src/modules/daily-report/domain/kpi-metrics.ts` | `investment_outflow` (Tiền ra), `net_growth` (Tăng net = vào − ra trên cùng Sale/TTKD), `aum` (Số dư đang đầu tư cuối ngày, theo Sale đang giữ khách), `renewal_rate` (tự động, dạng tỷ lệ). Tiền vào bỏ khoản có `renewal_of` |
| Tỷ lệ | `daily-report-board.workflow.ts` | Ô tỷ lệ trả `rate_day/rate_month/rate_year`, `plan_rate`, `pct_* = tỷ lệ / KH`; KH tỷ lệ trong file kế hoạch nhập `70` hay `0.7` đều hiểu là 70% |
| Xu hướng | `GET /daily-reports/trend?metric=&granularity=week\|month&to=YYYY-MM-DD&periods=` (`daily_report.view`) — `src/workflows/daily-report-trend.workflow.ts` | Tuần bắt đầu thứ Hai / tháng dương lịch, kỳ cuối tính tới ngày xem; mặc định 8 tuần / 6 tháng, tối đa 24 kỳ; cộng dồn lên cây đơn vị như bảng tổng hợp; chỉ tiêu tỷ lệ trả thêm tử/mẫu |
| Cây đơn vị + phạm vi xem | `src/workflows/daily-report/unit-tree.ts` | Dùng chung cho tổng hợp và xu hướng |

**Sửa lỗi phạm vi xem (ảnh hưởng cả bảng tổng hợp đã có ở PR #179/#181):** trước đây "toàn công ty" xác định bằng
`toMongoQuery(...)` rỗng; quyền thật từ RBAC luôn mang `conditions: {}` nên ra `{$or:[{},{}]}` → BLĐ bị coi là
xem theo phạm vi Sale, tổng bỏ sót khách chưa phân bổ. Nay xét trực tiếp quy tắc quyền (có quy tắc cho phép không
điều kiện, không có quy tắc chặn).

Test: `__tests__/investmentClosureTrend.test.ts` (ánh xạ TIKLUY, kỳ tuần/tháng, đồng bộ + chạy thử + chạy lại + lỗi 1
khách, chuỗi tái tục, tiền ra / tăng net / AUM / tái tục trên bảng tổng hợp, xu hướng theo tháng/tuần, phạm vi
quản lý, quyền RBAC 2 role).

### 8.2 Web — `/bang-dieu-hanh` "Bảng điều hành kinh doanh" (menu Báo cáo & Phân tích, quyền `daily_report.view`)

- Bộ lọc: ngày xem, kỳ (trong ngày / lũy kế tháng / lũy kế năm), phạm vi so sánh (tất cả TTKD hoặc các đơn vị trực
  thuộc 1 Khối / Chi nhánh), chỉ tiêu.
- Thẻ: Tiền vào, Tiền ra, Tăng net, Số dư đang đầu tư (cuối ngày), Tỷ lệ tái tục — kèm % kế hoạch.
- Xếp hạng: biểu đồ thanh + bảng TH / KH / % HT / số Sale / bình quân mỗi Sale, xếp theo thực hiện hoặc % hoàn
  thành; "Chưa gán TTKD" / "Chưa phân bổ" ghi riêng dưới bảng; bấm tên đơn vị mở bảng KPI 13 cột.
- Xu hướng theo tuần / tháng: mỗi đơn vị trong phạm vi 1 đường (tối đa 8, màu cố định theo đơn vị).
- Bản đồ % hoàn thành KPI: đơn vị × chỉ tiêu có giao kế hoạch, màu theo tiến độ thời gian.
- Bảng KPI 13 cột, bảng cây và file Excel của "Tổng hợp báo cáo ngày" hiển thị chỉ tiêu tỷ lệ theo `rate_*` /
  `plan_rate`.

### 8.3 Trước khi bật trên live

1. Đã đối chiếu dữ liệu live 13/11/2026: mã khoản, định dạng ngày, giá trị `formOfMaturity` (đã sửa theo dữ liệu thật). Còn hỏi TIKLUY: ngày tất toán thật của khoản tất toán trước hạn (API chỉ trả ngày đáo hạn hợp đồng) và tải gọi API hằng đêm.
2. Deploy API (có cron 01:30) → chạy `scripts/syncInvestmentClosures.ts --app=tikluy --dry-run --limit=50`, đối chiếu
   vài khách với TIKLUY → chạy thật toàn bộ (chạy bù lịch sử).
3. Thêm `renewal_rate` vào file kế hoạch KPI của Sale Priority (vd `"renewal_rate": 70`) rồi seed lại kế hoạch.
4. Thẻ "Tổng đầu tư (AUM)" ở Dashboard CRM cũ cộng mọi khoản (không trừ tất toán) nên sẽ lớn hơn "Số dư đang đầu
   tư" ở Bảng điều hành — cần thống nhất 1 định nghĩa nếu BLĐ hỏi.
