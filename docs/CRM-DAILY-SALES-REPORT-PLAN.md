# Báo cáo ngày CRM, Bảng điều hành KPI & Trợ lý AI cho Lãnh đạo — Kế hoạch triển khai

> Trạng thái: **ĐỀ XUẤT — chờ duyệt (12/11/2026)**. Chưa code.
> **Cập nhật 12/11/2026**: làm **TIKLUY trước** (`app_code=tikluy`), VNFITE (Gọi vốn, cho vay FE Credit) để sau;
> nhân lực **1 dev + Claude** → lộ trình mục 5 viết lại theo tuần; thêm mục 3.6 đánh giá theo trung tâm/chi nhánh.
> **Luồng ghi nhận khách + báo cáo ngày đã chốt 12/11/2026** (13 câu): xem `CRM-DAILY-REPORT-FLOWS.md` — tài liệu đó là căn cứ khi code,
> chỗ nào khác với tài liệu này thì theo tài liệu luồng.
> Căn cứ: Biên bản họp với Khối Công nghệ ngày 05/11/2026 (mục 2.1–2.5, 2.7); file "Khung KPI – TTKD và Priority"
> (bản khung trống + bản có trọng số/KH năm cho TTKD, Priority Chi + Tủn, Priority Hoa Anh); khảo sát code API/web/app ngày 12/11/2026.
> Ngoài phạm vi tài liệu này (BBH có nhưng làm riêng): tờ trình/đề nghị thanh toán/ký số (mục 2.6); tắt xem/xuất danh sách khách
> toàn hệ thống (mục 2.4 — phần lớn đã có qua quyền `customer.export` + `data_export_log`).

## 0. Tóm tắt

```
[Nguồn dữ liệu sẵn có]                 [Lớp KPI dùng chung]                    [Người dùng]
investments, customers  ─┐
call_log (OMICall)      ─┼─► kpi_daily_fact ◄── daily_report        Sale: kế hoạch sáng / kết quả chiều (web + app)
fec_lead, agents        ─┘   (nhân sự × ngày × chỉ tiêu)  (số nhập tay   Quản lý: tình hình nộp, duyệt điều chỉnh
                                     ▲                  + bằng chứng)   Lãnh đạo: bảng KPI 13 cột ngày / lũy kế tháng / năm
                              kpi_plan (KH năm → tháng → ngày)          Trợ lý AI hỏi bằng tiếng Việt + slide giao ban tuần
```

- **Auto-first**: số nào hệ thống đã có thì tự điền và **không cho nhập tay**; Sale chỉ nhập phần hệ thống chưa có (kèm bằng chứng) và giải trình.
- **Một nguồn số duy nhất** (`kpi_daily_fact`): dashboard, file Excel, câu trả lời AI và slide giao ban luôn khớp nhau.
- Chỉ tiêu tự động tính hồi tố được → ngày go-live đã có **lũy kế tháng 11 và lũy kế năm 2026** cho phần tự động.
- 4 lỗ hổng dữ liệu phải xử lý: (1) tiền ra (tất toán/tái tục) chưa về vWork → Doanh số NET và Tỷ lệ tái tục chưa tính được;
  (2) chưa có khái niệm Merchant, Roadshow, cuộc hẹn có bằng chứng; (3) Đại lý/CTV không gắn Sale phát triển;
  (4) chưa có nhóm chức danh KPI và kế hoạch KPI theo người.
- Phạm vi đợt đầu: **chỉ TIKLUY**. Mọi số liệu lọc theo `app_id` TIKLUY; chỉ tiêu "Gọi vốn" (VNFITE) và cho vay FE Credit hiện "chưa áp dụng".
- Đánh giá được **từng trung tâm kinh doanh** (và lọc theo chi nhánh) — mỗi dòng số lưu kèm đơn vị của Sale tại ngày phát sinh (mục 3.6).
- **Bản nhanh 2 ngày** (mục 5.0): Sale nộp báo cáo ngày trên web, lãnh đạo xem tổng hợp theo TTKD — pilot dùng ngay.
  Phần còn lại (app, AI, GPS + ảnh, cấu hình KPI, cảnh báo…) theo lộ trình tuần, toàn bộ TTKD TIKLUY từ **kỳ KPI 2027 (04/01/2027)**.

## 1. Hiện trạng — cái đã có và dùng lại được

| Thành phần | Vị trí | Dùng cho tính năng mới | Hạn chế phát hiện |
|---|---|---|---|
| Danh mục chỉ tiêu (`kpi_metric`: output/input, auto/manual) + 12 chỉ tiêu seed | `src/models/KpiMetricModel.js`, `scripts/seedKpiMetrics.js`, route `/kpi-metrics` | Nền cho danh mục chỉ tiêu | Chưa có trọng số, kế hoạch, cách cộng dồn; `telesale_call` đang là *manual* dù đã có tổng đài; web `/hrm/quan-ly-kpi` mới là ComingSoon |
| `sale_kpi` (target/actual theo tháng) | `src/models/SaleKpiModel.js` | Chỉ dùng cho biểu đồ "KPI tác nghiệp tương tác" | Field cố định, không theo khung KPI mới → thay bằng `kpi_plan` |
| Khoản đầu tư | `investments`, `POST /investments/upsert` (TIKLUY gọi) | Doanh số theo ngày, KH mới có giao dịch | Khi đổi trạng thái chỉ ghi `status` (`InvestmentController.js:160`), **không có ngày/số tiền tất toán**; TIKLUY chưa gửi sự kiện tất toán/tái tục (`CRM-CUSTOMER-CARE-SLA-PLAN.md` mục 1) |
| Khách hàng (CIF, eKYC, `referred_by`, `app_id` VNFITE/TIKLUY) | `customers` | CIF mới, eKYC theo Sale | — |
| Cuộc gọi OMICall (webhook, thời lượng, ghi âm, `sale_id`) | `call_log`, module `customer-call` | Telesale tự động + bằng chứng gọi | Chỉ ghi nhận cuộc gọi qua tổng đài |
| Báo cáo chăm sóc 4 trường (Quy định 183A) | `customer_interaction`; web `CareReportModal`, app `CareReportSheet` | Cuộc hẹn (`meeting`), tin nhắn CSKH | Chưa có đính kèm ảnh |
| Khoản vay FE Credit | module `fec-lead` (`offer_amt`, `cash_amt`, `stage`) | Doanh số cho vay | Không có dư nợ |
| Đại lý/CTV | `agents` | CTV mới | **Không có field Sale phát triển** |
| Cây tổ chức (TTKD HN/HP/HCM/Priority/Online/Đối tác), `department.manager` | `departments`, `scripts/seedOrgTree.js` | Gom số theo trung tâm, phạm vi xem | — |
| Phân quyền ABAC/CASL + data scope | `requirePermission`, `toMongoQuery`, `docs/RBAC-SYSTEM-GUIDE.md` | Quyền nộp/xem/duyệt, phạm vi dữ liệu | — |
| Ngày lễ, nghỉ phép | `HolidayModel`, module `timesheet`/`request` | Ngày làm việc còn lại; miễn báo cáo khi nghỉ có đơn | — |
| Cron + push FCM + deep link | `src/jobs/`, `pushNotification.sendToAccount`, app `crmCustomerCare/lib/careNavigation.js` | Nhắc nộp, chốt sổ, cảnh báo | — |
| Báo cáo tuần (pending/submitted/late/missing, màn tổng hợp) | `weeklyReport*`, web `WeeklyReportsScreen` | Khuôn trạng thái + màn tổng hợp | Nộp file, không phải form |
| AI: chat có tool use, tóm tắt KH, churn risk | `src/controllers/AiController.js`, `src/config/anthropic.js` | Khung trợ lý AI | Xem mục 4.6 |
| Dashboard CRM (key-metrics, funnel, AUM, leaderboard, sales-chart), `@mui/x-charts` | `DashboardController.js`, web `CrmExecutiveDashboard.jsx` | Bộ chọn kỳ (hôm nay/tháng/quý/năm), biểu đồ thực hiện vs chỉ tiêu | Không có kế hoạch, lũy kế |
| GPS (`expo-location`) + check-in | app `features/attendance` | Xác thực hoạt động thực địa | App chưa chụp được bằng camera (chỉ chọn từ thư viện) → cần thêm quyền camera và **build native mới** |
| Xuất Excel (`xlsx`), nhật ký xuất (`data_export_log`) | API + web | Xuất bảng KPI theo mẫu | — |

Web: nhóm menu **"Báo cáo & Phân tích"** (`CrmMenuItems.js:249-295`) đang có 4 mục disabled — đặt màn mới ở đây.
App: thẻ "Cuộc gọi hôm nay" trên dashboard CRM đang hard-code "—"; các hook dashboard đã viết nhưng chưa màn nào dùng.

## 2. Đối chiếu chỉ tiêu KPI với dữ liệu

Phân loại: **Tự động** = đã có dữ liệu · **Bổ sung DL** = tự động sau khi bổ sung dữ liệu · **Nhập tay + BC** = nhập tay kèm bằng chứng.

### 2.1 KPI Trung tâm kinh doanh (tổng trọng số = 100%)

| # | Chỉ tiêu | ĐVT | Trọng số | KH năm (bản mẫu) | Nguồn đề xuất | Loại | Cần chốt |
|---|---|---|---|---|---|---|---|
| 1 | Đầu tư | Triệu VNĐ | 25% | 250.000.000 | `investments.amount` app TIKLUY theo `invested_at`, gán Sale qua `commission.sale_id` | Tự động | Gross hay NET? Tái tục có tính? |
| 2 | Gọi vốn | Triệu VNĐ | 25% | 300.000.000 | Giả thuyết: doanh số app VNFITE (menu web "Khách hàng › Gọi vốn" chỉ hiện khi chọn VNFITE) | **Đợt TIKLUY: chưa áp dụng.** Sau: tự động nếu đúng giả thuyết, ngược lại nhập tay + chứng từ | **Định nghĩa**; khi chưa áp dụng thì điểm tổng chia lại trọng số hay tính 0? |
| 3 | CIF | Khách hàng | 10% | 20 | `customers.registeredAt`, `referred_by` = Sale | Tự động | Đăng ký hay eKYC xong? Tính KH < 18 tuổi? |
| 4 | Merchant sale | Merchant | 10% | 10 | Chưa có trên hệ thống → danh mục merchant tối giản (tên, SĐT, địa chỉ, ảnh + GPS tại điểm) | Nhập tay + BC | Merchant là gì, có hệ thống nguồn? |
| 5 | Cộng tác viên | CTV | 10% | 12 | `agents` cá nhân mới tạo + **thêm field Sale phát triển** | Bổ sung DL | CTV = đại lý cá nhân? |
| 6 | Merchant Active | Merchant | — | 8 | Như #4, trạng thái active | Nhập tay | Có KH nhưng không có trọng số |
| 7 | Cuộc hẹn tư vấn KH | Cuộc hẹn | 10% | (trống) | `customer_interaction` type `meeting` + check-in GPS/ảnh tại điểm hẹn (app) | Bổ sung DL | Thiếu KH năm |
| 8 | Telesale | Cuộc gọi | — | — | `call_log` OMICall: cuộc gọi ra, **hợp lệ khi nghe máy ≥ 20 giây** (cùng ngưỡng 183A) | Tự động, khoá nhập tay | Chỉ theo dõi? |
| 9 | Roadshow | Buổi | — | — | Ghi nhận thực địa: GPS + ảnh + số người tham dự + SĐT KH quan tâm thu được | Nhập tay + BC | |
| 10 | Tính tuân thủ | % | 10% | 100% | Tự tính: % ngày làm việc nộp kế hoạch **và** kết quả đúng giờ (trừ ngày nghỉ có đơn duyệt); tuỳ chọn cộng tỷ lệ đúng SLA 183A | Tự động | Công thức |
| 11 | Other (khác) | Việc | — | — | Nhập tay | Nhập tay | Có tính điểm? |

### 2.2 KPI Priority

| # | Chỉ tiêu | ĐVT | Trọng số | KH năm | Nguồn đề xuất | Loại | Cần chốt |
|---|---|---|---|---|---|---|---|
| 1 | Đầu tư | Triệu VNĐ | 50% | 800.000.000 (Chi + Tủn) / 150.000.000 (Hoa Anh) | Như TTKD #1 | Tự động | KH 800 triệu là chung 2 người hay mỗi người? |
| 2 | CIF KH mới có giao dịch | Khách hàng | 20% | 10 | KH thuộc Sale có **khoản đầu tư đầu tiên** rơi vào kỳ | Tự động | KH phải đăng ký trong kỳ? |
| 3 | Tỷ lệ tái tục đầu tư | % | 20% | 70% | Tiền tái tục / tiền đáo hạn trong kỳ | **Chưa tính được** — cần TIKLUY gửi sự kiện đáo hạn/tái tục | Theo tiền hay số khoản? |
| 4 | Tính tuân thủ | % | 10% | 100% | Như TTKD #10 | Tự động | |

### 2.3 Bốn chỉ số cốt lõi của báo cáo ngày (BBH mục 2.3)

| Chỉ số | Đáp ứng | Cách lấy / còn thiếu |
|---|---|---|
| Doanh số đầu tư & tích lũy trong ngày + lũy kế tháng | Có (tiền vào) | `investments`; NET cần tiền ra (mục 4.2) |
| Doanh số cho vay & biến động dư nợ | Một phần | Giải ngân FE Credit từ `fec_lead.cash_amt` khi hoàn tất; **không có dữ liệu dư nợ** |
| Số lượng mở Ship & lượt tải ứng dụng | Chưa rõ | "Mở Ship" là gì? Lượt tải thật không quy được về Sale → đề xuất dùng "đăng ký app bằng mã Sale" |
| Điểm bán, đại lý, CTV mới gắn mã định danh | Một phần | Đại lý/CTV: `agents` + field Sale phát triển; điểm bán (merchant): chưa có |

### 2.4 Quy ước tính 13 cột của mẫu

| Cột | Công thức |
|---|---|
| KH kỳ | Kế hoạch của kỳ đang xem (ngày/tuần/tháng/quý), phân bổ từ KH năm (mục 3.1) — bản mẫu đang để trống |
| TH kỳ | Thực hiện trong kỳ |
| % HT kỳ | TH kỳ / KH kỳ |
| Lũy kế năm | TH từ 01/01 đến ngày xem |
| % HT năm | Lũy kế năm / KH năm |
| % còn phải HT | max(0, 100% − % HT năm) |
| Số còn thiếu | max(0, KH năm − Lũy kế năm) |
| *Đề xuất thêm:* Tiến độ thời gian | Ngày làm việc đã qua / tổng ngày làm việc của kỳ → so với % HT để tô màu |
| *Đề xuất thêm:* Cần đạt mỗi ngày | Số còn thiếu của kỳ / số ngày làm việc còn lại |

- Chỉ tiêu tỷ lệ (tái tục, tuân thủ): cộng dồn **tử số và mẫu số** rồi mới chia; không cộng hay trung bình các %.
- Điểm KPI tổng = Σ (trọng số × min(% HT, trần)); trần đề xuất 120%, cần chốt.
- **Đơn vị tiền**: bản mẫu ghi "Triệu VNĐ" nhưng giá trị là 250.000.000 — nếu hiểu là triệu thì thành 250.000 tỷ, phi thực tế.
  Hệ thống lưu mọi số tiền bằng **đồng**, hiển thị theo triệu; cần xác nhận KH = 250 triệu đồng.

## 3. Thiết kế nghiệp vụ

### 3.1 Bộ chỉ tiêu & giao kế hoạch

- **Bộ KPI** theo nhóm chức danh: danh sách chỉ tiêu + trọng số + có tính điểm không. Khởi tạo 2 bộ từ Excel: `TTKD` (11 chỉ tiêu),
  `PRIORITY` (4 chỉ tiêu). Các nhóm còn lại theo BBH 2.2 (đa năng, tín dụng, đầu tư, quản lý trung tâm…) thêm khi có Quyết định.
- **Hồ sơ KPI nhân sự**: nhân sự ↔ bộ KPI ↔ đơn vị, có hiệu lực từ/đến (điều chuyển giữa kỳ không mất lịch sử). Quản lý trung tâm có bộ
  riêng và không nhận lead telesale (BBH 2.2) — liên kết `sale_allocation_profile` của 183A để loại khỏi phân khách.
- **Kế hoạch KPI**: KH năm theo người (và/hoặc theo trung tâm), đính kèm số/file Quyết định giao chỉ tiêu, trạng thái nháp → đã duyệt.
  Phân bổ tháng mặc định chia đều 12 tháng, cho phép sửa từng tháng. KH ngày không lưu mà tính động:
  (KH tháng − TH lũy kế tháng đến hôm qua) / số ngày làm việc còn lại → Sale biết "hôm nay cần bao nhiêu để kịp tháng".
- **Nhập kế hoạch từ Excel** đúng mẫu "Khung KPI" (mỗi sheet = 1 người/nhóm) để Ban kế hoạch không phải gõ lại.
- Số trung tâm = Σ cá nhân (mặc định), hoặc KH giao riêng cho trung tâm nếu có.

### 3.2 Báo cáo ngày của Sale

| Mốc (cấu hình được) | Việc | Ai |
|---|---|---|
| 00:05 | Tạo phiếu nháp cho mọi nhân sự có hồ sơ KPI; ngày lễ hoặc nghỉ có đơn duyệt → `exempt` | Hệ thống |
| 07:30–09:30 | **Kế hoạch ngày**: hệ thống gợi ý "cần đạt hôm nay" từng chỉ tiêu + việc gợi ý (KH đáo hạn 7 ngày tới, KH đã eKYC chưa đầu tư, hàng đợi "Khách cần xử lý", KH quan tâm cần gọi lại). Sale chốt mục tiêu + hoạt động dự kiến (vd 40 cuộc gọi, 2 cuộc hẹn kèm SĐT, roadshow tại…) → Nộp | Sale |
| 08:45 | Nhắc người chưa nộp kế hoạch (push) | Hệ thống |
| Trong ngày | Ghi nhận thực địa (app: chụp ảnh + GPS), bằng chứng tin nhắn CSKH, KH quan tâm theo SĐT | Sale |
| 16:30 | Nhắc nộp kết quả | Hệ thống |
| 16:30–17:30 | **Kết quả ngày**: số tự động điền sẵn (chỉ xem); Sale nhập phần còn lại (kèm danh sách/bằng chứng), giải trình chênh lệch KH–TH, khó khăn, đề xuất → Nộp | Sale |
| 17:30 | **Chốt sổ**: khoá phiếu; chưa nộp → `missing`, nộp sau giờ → `late`; gửi bản tổng hợp cho quản lý | Hệ thống |
| Sau chốt | Sửa số phải tạo **yêu cầu điều chỉnh** (lý do + bằng chứng) → quản lý trực tiếp duyệt; lưu vết (BBH 2.7) | Sale → QL |
| 01:00 hôm sau | Tính lại số tự động D-1…D-7 (dữ liệu TIKLUY/OMICall về muộn); ghi chênh lệch nếu khác lúc chốt | Hệ thống |

Trạng thái phiếu: `draft → plan_submitted → submitted | late | missing | exempt`, cộng cờ `locked`.
Quản lý xem bảng nộp báo cáo của đơn vị theo thời gian thực, nhận xét phiếu, duyệt điều chỉnh.

### 3.3 Xác thực dữ liệu (BBH 2.3)

| Biện pháp BBH | Cách làm |
|---|---|
| Lưu vết cuộc gọi & tin nhắn | Telesale chỉ lấy từ OMICall (khoá nhập tay); quy định bắt buộc gọi qua tổng đài. Tin nhắn CSKH: thêm đính kèm ảnh vào báo cáo chăm sóc 4 trường đã có |
| GPS + ảnh thực địa | Màn "Ghi nhận thực địa" trên app: **chỉ chụp trực tiếp bằng camera**, lấy GPS lúc chụp, thời gian theo server, độ chính xác ≤ 100 m; Android phát hiện vị trí giả (`mocked`); ảnh trùng (hash) hoặc vị trí bất thường → **gắn cờ cho quản lý xem**, không chặn cứng |
| KH quan tâm theo SĐT | Danh sách KH tiềm năng của Sale (SĐT chuẩn hoá, chống trùng). Khi TIKLUY/VNFITE đẩy khách đăng ký cùng SĐT → tự nối phễu quan tâm → đăng ký → eKYC → đầu tư, đo tỷ lệ và thời gian chuyển đổi |
| Lệch chỉ số tăng ròng | Mục 4.2 |
| *(thêm)* Số nhập tay có đối ứng | CTV/merchant/cuộc hẹn nhập **theo danh sách có định danh** (mã CTV, SĐT khách, merchant) chứ không nhập con số trơn → hệ thống tự đếm, đối soát được |

### 3.4 Bảng điều hành cho lãnh đạo

- **Tổng quan ngày** (mặc định hôm nay): tình hình nộp (kế hoạch x/y, kết quả x/y, trễ, thiếu — bấm ra danh sách); 4 chỉ số cốt lõi theo ngày / lũy kế tháng / lũy kế năm, so cùng kỳ.
- **Bảng KPI đúng mẫu 13 cột** cho toàn khối → từng TTKD → từng nhân sự; chọn kỳ ngày/tuần/tháng/quý/năm/tuỳ chọn (dùng lại bộ chọn kỳ của `CrmExecutiveDashboard`). Tô màu theo % HT so với tiến độ thời gian. Xuất Excel đúng mẫu (ghi `data_export_log`).
- **Xếp hạng & cảnh báo**: heatmap TTKD × chỉ tiêu; cá nhân/đơn vị dưới ngưỡng (vd < 70% tiến độ thời gian, hoặc 3 ngày liền không đạt KH ngày) → push cho quản lý trực tiếp; **vinh danh** top tuần/tháng (BBH 2.1).
- **Drill-down**: TTKD → nhân sự → phiếu báo cáo ngày → bằng chứng (ảnh, bản đồ, cuộc gọi kèm ghi âm).
- Phạm vi xem theo quyền: Sale chỉ của mình; quản lý TTKD trung tâm mình; lãnh đạo khối/PTGĐ toàn bộ (mục 4.3).

### 3.5 Trợ lý AI cho lãnh đạo (BBH 2.5)

1. **Hỏi đáp số liệu** bằng tiếng Việt, ví dụ: "Hôm nay đơn vị nào chưa nộp báo cáo?", "Lũy kế tuần này TTKD Hà Nội đầu tư bao nhiêu, đạt bao nhiêu % kế hoạch tháng?",
   "Ai trong Priority đang chậm tiến độ nhất?", "So sánh CIF tháng 11 với tháng 10 theo trung tâm".
2. **Phân tích & đề xuất**: chỉ ra chỉ tiêu tụt, nguyên nhân có số liệu chứng minh (vd cuộc gọi giảm 40%, tỷ lệ eKYC → đầu tư giảm, giải trình của Sale nêu…), khuyến nghị theo trung tâm.
3. **Slide giao ban tuần** tự động (sáng thứ Hai) + bản tin cuối ngày 17:45.

Nguyên tắc: AI **không tự viết truy vấn DB**, chỉ gọi các công cụ đọc do backend định nghĩa trên `kpi_daily_fact`/`daily_report`;
mọi công cụ tự áp phạm vi quyền của người hỏi; câu trả lời luôn kèm kỳ số liệu và thời điểm cập nhật; không trả SĐT/CCCD khách cho câu hỏi tổng hợp.

### 3.6 Đánh giá theo trung tâm kinh doanh / chi nhánh

**Hiện trạng: hệ thống đang có 2 cách gắn Sale với đơn vị, chạy song song và có thể lệch nhau:**

| Trục | Lưu ở đâu | Đang dùng ở | Đặc điểm |
|---|---|---|---|
| Phòng ban / TTKD (cây tổ chức) | `user_department_position` → `departments` (TTKD-HN, HP, HCM, PRIORITY, ONLINE, PARTNER dưới `KHOI-CN`) | Data scope phân quyền ABAC, `DashboardController` (phạm vi quản lý), báo cáo tuần | Có phân cấp, có người phụ trách (`department.manager`), 1 người có thể thuộc nhiều phòng ban |
| Chi nhánh (danh mục HRM) | `user_info.branch_id` → `branches` | Biểu đồ doanh số `GET /investments/sales-chart` (chia theo chi nhánh), chấm công | Danh sách phẳng, mỗi người 1 chi nhánh |

Ngoài ra quy tắc gán Sale cho doanh số cũng chưa thống nhất: `sales-chart` gán theo `customer.referred_by` (Sale đang giữ khách),
còn danh sách đầu tư/hoa hồng gán theo `commission.sale_id` (Sale hưởng hoa hồng lúc phát sinh).

**TTKD đã có trong mô hình**: phòng ban `type = "branch"` (form Phòng ban trên web `DepartmentFormDialog.jsx` và app `hrm/department.js`
hiển thị nhãn "Chi nhánh (TTKD)"); `scripts/seedOrgTree.js` tạo sẵn 6 TTKD dưới `KHOI-CN`. Chưa xác minh được trên DB live là Sale
TIKLUY đã được gán vào TTKD hay chưa (chạy script ở mục 6.4 #30). Hai thứ cùng tên "Chi nhánh" (loại phòng ban TTKD và danh mục
`/hrm/chi-nhanh`) dễ gây nhầm khi nhập liệu → đổi nhãn loại phòng ban thành "Trung tâm kinh doanh (TTKD)".

**Đề xuất:**

1. **Trục đánh giá chính = cây tổ chức (TTKD)**: có phân cấp Khối → TTKD → (nhóm nếu có), có người phụ trách để phân quyền xem, khớp data scope đang dùng.
   "Chi nhánh" (`branches`) giữ làm **bộ lọc phụ** (địa điểm làm việc). Nếu thực tế có "Trung tâm Hà Nội 1, 2…" (BBH nhắc "Trung tâm Hà Nội 1")
   thì tạo thành node con của TTKD-HN trong cây tổ chức.
2. **Đơn vị KPI chính của mỗi Sale** = `kpi_profile.department_id` (giải quyết trường hợp 1 người thuộc nhiều phòng ban).
3. **Ghi nhận theo thời điểm phát sinh**: mỗi dòng `kpi_daily_fact` lưu `department_id` (và `branch_id`) của Sale *tại ngày đó* →
   Sale điều chuyển giữa tháng thì số cũ vẫn thuộc TTKD cũ, số mới thuộc TTKD mới.
4. **Quy tắc gán Sale thống nhất**: doanh số đầu tư theo `commission.sale_id` (người giữ khách lúc khách đầu tư — khớp quy tắc hoa hồng 183A);
   CIF theo Sale giữ khách tại ngày đăng ký, **chốt lại sau ngày đó** (không đổi khi khách bị thu hồi/phân lại về sau). Sửa `sales-chart` theo cùng quy tắc.
5. **Số không thuộc Sale nào** (khách marketing chưa phân, khách của đại lý chưa gắn Sale) hiện thành dòng riêng **"Chưa phân bổ / Kênh đại lý"**
   → tổng các TTKD + dòng này = tổng công ty, đối soát được.
6. **Kế hoạch theo trung tâm**: mẫu Excel có dòng "Đơn vị áp dụng" → cho phép giao KH trực tiếp cho TTKD; nếu không giao riêng thì KH TTKD = Σ KH các Sale.

**Màn đánh giá trung tâm** (nằm trong Bảng điều hành KPI):

- Bảng 13 cột cho từng TTKD + **điểm KPI có trọng số** của TTKD; bấm vào để xuống từng Sale.
- **Xếp hạng các TTKD** theo điểm tổng và theo từng chỉ tiêu; heatmap TTKD × chỉ tiêu tô màu theo % HT so với tiến độ thời gian.
- **So sánh công bằng giữa TTKD khác quy mô**: % HT kế hoạch, bình quân trên đầu Sale, tỷ lệ chuyển đổi phễu (CIF → eKYC → đầu tư),
  tỷ lệ nộp báo cáo đúng hạn / tuân thủ của TTKD, tỷ lệ đúng SLA 183A.
- Xu hướng theo tuần/tháng của từng TTKD; cảnh báo TTKD chậm tiến độ cho người phụ trách.
- Lọc thêm theo chi nhánh để xem cùng TTKD nhưng khác địa điểm.

**Điều kiện cần về dữ liệu** (kiểm tra trước go-live, script đếm ở mục 6.4): mọi Sale TIKLUY đang giữ khách phải thuộc đúng 1 TTKD trong cây tổ chức;
người phụ trách từng TTKD được gán `department.manager`; danh mục chi nhánh khớp thực tế.

## 4. Thiết kế kỹ thuật

### 4.1 API — module mới (TypeScript, DDD/Hexagonal theo `src/modules/request/`)

**`src/modules/sales-kpi/`** sở hữu:

| Collection | Nội dung chính |
|---|---|
| `kpi_metric` (mở rộng) | Thêm `aggregation` (`sum`/`ratio`/`snapshot`), `allow_manual`, `evidence_required`; `auto_source` mới: `capital_raising`, `call_valid`, `cif_first_investment`, `renewal_rate`, `agent_new`, `consult_meeting`, `compliance`, `loan_disbursed`; đổi `telesale_call` sang auto. Chuyển quyền sở hữu model từ `KpiMetricController` cũ sang module |
| `kpi_template` | `code`, `name`, `items[{metric_code, weight, scored, order}]`, hiệu lực |
| `kpi_profile` | `employee_id` (UserInfo), `template_id`, `department_id`, `effective_from/to` |
| `kpi_plan` | `scope_type` (employee/department), `scope_id`, `year`, `metric_code`, `annual_target`, `monthly_targets[12]`, `decision_ref` + file, `status`, `approved_by` |
| `kpi_daily_fact` | `date` (DateKey), `employee_id`, `department_id`, `app_id`, `metric_code`, `value` (+ `numerator`/`denominator` cho tỷ lệ), `source` (auto/manual), `computed_at`; unique (`date`, `employee_id`, `metric_code`) |

**`src/modules/daily-report/`** sở hữu:

| Collection | Nội dung chính |
|---|---|
| `daily_report` | `employee_id`, `department_id`, `report_date`, `status`, `plan{submitted_at, targets[], activities[], note}`, `result{submitted_at, manual_values[{metric_code, value, items[], evidence_ids[]}], auto_snapshot[], variance_note, blockers, proposals}`, `review{by, comment}`, `locked_at` |
| `field_activity` | Loại (tờ rơi / tiếp cận trực tiếp / treo dán / roadshow / thăm merchant / cuộc hẹn), `lat/lng/accuracy/mocked`, `photos[]` (+ hash), `captured_at` (server), `customer_phone?`, `attendees?`, `flags[]` |
| `daily_report_adjustment` | Phiếu, chỉ tiêu, giá trị cũ → mới, lý do, bằng chứng, `status`, người duyệt |
| `sales_lead` | `phone` (chuẩn hoá), tên, nguồn, `owner_sale_id`, `status`, `converted_customer_id`, mốc thời gian từng bước |

**Tính số tự động** — `src/workflows/kpi-fact-sources/` theo mẫu registry `request-side-effects`: mỗi `auto_source` một file
`compute(dateRange) → [{employee_id, value}]`, đăng ký vào `KPI_FACT_SOURCES`. Job mỗi 15 phút (07:00–20:00) tính hôm nay;
01:00 tính lại D-1…D-7; script `backfillKpiFacts.ts --from=2026-01-01` để có lũy kế năm ngay khi go-live.

Endpoint mới (đề xuất):

```
# Cấu hình (Ban kế hoạch)
GET/POST/PATCH  /kpi-templates
GET/POST/PATCH  /kpi-profiles
GET/POST/PATCH  /kpi-plans        POST /kpi-plans/import (Excel mẫu "Khung KPI")    POST /kpi-plans/:id/approve

# Sale
GET   /daily-reports/me?date=           # phiếu điền sẵn số tự động + "cần đạt hôm nay" + việc gợi ý
PUT   /daily-reports/me/plan            POST /daily-reports/me/plan/submit
PUT   /daily-reports/me/result          POST /daily-reports/me/result/submit
POST  /daily-reports/:id/adjustments    POST /daily-report-adjustments/:id/review
POST  /field-activities (multipart)     GET  /field-activities?date=
GET/POST/PATCH /sales-leads

# Quản lý / lãnh đạo
GET   /sales-performance/submission?date=&department_id=
GET   /sales-performance/scorecard?level=company|department|employee&id=&period=day|week|month|quarter|year&date=
GET   /sales-performance/ranking?metric=&period=
GET   /sales-performance/scorecard/export        # Excel theo mẫu 13 cột

# AI
POST  /ai/assistant/chat (SSE stream)            GET /ai/assistant/conversations
POST  /ai/assistant/weekly-deck
```

Cron mới (`src/jobs/dailyReportJob.js`, đăng ký trong `src/jobs/index.js`): 00:05 tạo phiếu · 08:45 nhắc kế hoạch · 16:30 nhắc kết quả ·
17:30 chốt sổ + tổng hợp · 17:45 bản tin · mỗi 15 phút tính fact · 01:00 tính lại · thứ Hai 06:30 slide giao ban.

### 4.2 Sửa dữ liệu nền (làm cùng đợt)

1. **Đầu tư — tiền ra**: thêm `closed_at`, `closed_principal`, `closed_payout`, `renewed_from_investment_id`, `renewed_to_investment_id`
   vào `InvestmentModel`; `upsert` ghi các field này khi đổi trạng thái. Đề nghị TIKLUY gửi sự kiện đáo hạn / tất toán trước hạn / tái tục
   **có retry** + bật bulk sync đối soát hằng đêm. Trong lúc chờ: job đêm đối soát qua API biến động số dư đã có
   (`/user/fluctuation/crm/alls`, đang dùng ở `CustomerController.getFluctuation`) cho khách có khoản đáo hạn — cần TIKLUY xác nhận chịu tải.
   BBH ghi "đồng bộ hai chiều": đề xuất **một chiều** (lõi → vWork) + đối soát; vWork không nên ghi ngược vào hệ thống lõi.
2. **Đại lý/CTV**: thêm `developed_by_sale_id`, `developed_at` vào `AgentModel` (nhận từ hệ thống nguồn, hoặc Sale khai báo → quản lý xác nhận).
3. **Merchant**: danh mục `merchant` tối giản nếu không có hệ thống nguồn.
4. **Bằng chứng tin nhắn**: thêm `attachments[]` vào `customer_interaction` + upload ảnh.
5. Bỏ dần `sale_kpi` (biểu đồ "KPI tác nghiệp tương tác" chuyển sang đọc `kpi_plan`/`kpi_daily_fact`); dọn các mã quyền KPI kiểu cũ trong
   `src/constants/permissions.js` (`kpi.year_plan.*`, `kpi.report.submit`, `kpi.monthend.close`… chỉ được seed, không route nào dùng).

### 4.3 Phân quyền

Mã quyền mới trong `permission_catalog`, kèm data scope:

| Mã | Ai | Phạm vi |
|---|---|---|
| `daily_report.submit` | Sale có hồ sơ KPI | Bản thân |
| `daily_report.view` | Quản lý TTKD, lãnh đạo | SELF / DEPARTMENT (gồm cây con) / ALL_COMPANY |
| `daily_report.review` (nhận xét, duyệt điều chỉnh) | Quản lý trực tiếp | DEPARTMENT |
| `kpi_plan.manage`, `kpi_template.manage` | Ban kế hoạch | ALL_COMPANY |
| `sales_performance.view`, `sales_performance.export` | Quản lý, lãnh đạo | Theo scope |
| `ai_assistant.use` | Lãnh đạo (danh sách chốt) | Dữ liệu = scope của `sales_performance.view` |

Lãnh đạo phụ trách nhiều khối không liền nhánh (`department.manager`) cần scope "các đơn vị tôi phụ trách + cây con" — kiểm tra policy hiện có trước khi tạo mới.

Named flag thêm **đồng thời** vào `usePermissions.js` (web) và `getPermissions()` (app), đọc permission code, không bypass admin (như nhóm
`showCustomerCare*`): `showDailyReport`, `showDailyReportMgmt`, `showSalesPerformance`, `showKpiConfig`, `showAiAssistant`.
Cập nhật bảng ma trận tính năng trong `CLAUDE.md` gốc.

### 4.4 Web (`vWork-website`)

| Màn | Vị trí menu | Ghi chú |
|---|---|---|
| Báo cáo ngày của tôi (Kế hoạch / Kết quả / Lịch sử) | CRM › Báo cáo & Phân tích | Số tự động chỉ đọc; khối "cần đạt hôm nay" |
| KPI của tôi | CRM › Báo cáo & Phân tích | Bảng 13 cột cá nhân |
| Tổng hợp báo cáo ngày (đơn vị) | CRM › Báo cáo & Phân tích | Khuôn từ `WeeklyReportsScreen` (AdminDashboard) |
| Bảng điều hành KPI | CRM › Báo cáo & Phân tích (thay mục "Hiệu suất đội ngũ") | `@mui/x-charts`, bộ chọn kỳ có sẵn |
| Duyệt điều chỉnh | CRM › Báo cáo & Phân tích | |
| Cấu hình KPI (bộ chỉ tiêu, gán nhân sự, kế hoạch, import Excel) | HRM › Quản lý KPI (`/hrm/quan-ly-kpi`, đang ComingSoon) | |
| Trợ lý AI | Panel nổi + trang riêng | Stream bằng `fetch` (axios đang timeout 10 giây); render markdown (thêm `react-markdown`); bảng/biểu đồ nhỏ |

### 4.5 App (`vWork`)

- Sale: màn Báo cáo ngày (kế hoạch/kết quả) — thêm tab hoặc quick action trên dashboard CRM; **Ghi nhận thực địa** (camera + GPS,
  app-only theo quy tắc `CLAUDE.md`); KH quan tâm theo SĐT; push deep link theo mẫu `careNavigation.js`.
- Thêm camera (`expo-image-picker` + `NSCameraUsageDescription`/quyền camera Android) → **cần build native mới và duyệt store** →
  đưa vào bản build ngay tuần 3 để tuần 6 (ghi nhận thực địa) không phải chờ.
- Dashboard CRM: thay "Cuộc gọi hôm nay: —" bằng số thật; thêm thẻ "Tiến độ KPI tháng".
- Quản lý (tuần 5): xem nhanh tình hình nộp + bảng KPI rút gọn; AI dùng lại `AiChatbotModal` (đang không kiểm quyền `ai_chat.use` ở UI — sửa).

### 4.6 AI Agent

**Hiện trạng cần sửa** (`src/controllers/AiController.js`, `src/config/anthropic.js`):

- Model `claude-haiku-4-5` (dòng 97, 365, 385), `max_tokens: 600` → quá ngắn cho phân tích, dễ bị cắt cụt.
- Vòng lặp tool (dòng 373–393) chỉ gửi lại **lượt tool gần nhất**: câu hỏi cần ≥ 2 lượt tool sẽ mất kết quả các lượt trước → trả lời sai hoặc lặp.
- Không streaming; web chờ một request với axios timeout 10 giây → câu hỏi phân tích dài sẽ lỗi.
- Nhánh `AI_PROVIDER=gemini` chỉ mô tả tool bằng chữ, **không thực thi tool** → model không có số liệu thật, dễ bịa; model `gemini-1.5-flash` đã cũ.
  Đề xuất bỏ nhánh này cho trợ lý.
- Chưa có nhật ký truy vấn AI (BBH 2.4 yêu cầu lưu nhật ký truy xuất).
- Web: `AiChatbot.jsx`, `AiSummaryCard.jsx` không được gắn vào trang nào (code chết).

**Thiết kế mới — module `src/modules/ai-assistant/`**

Công cụ (chỉ đọc, gọi application service của `sales-kpi`/`daily-report`):

| Tool | Trả về |
|---|---|
| `find_units_or_people(query)` | Đổi tên TTKD/nhân sự → id (trong phạm vi quyền) |
| `get_scorecard(level, ids, period, date_from, date_to, metrics?)` | KH / TH / % HT / lũy kế / còn thiếu / tiến độ thời gian |
| `get_submission_status(date, unit?)` | Ai đã/chưa/trễ nộp kế hoạch, kết quả |
| `compare_periods(level, ids, metric, period_a, period_b)` | Chênh lệch, % thay đổi |
| `rank(level, metric, period, order, limit)` | Xếp hạng |
| `get_daily_report_notes(target, date_range)` | Giải trình, khó khăn, đề xuất của Sale |
| `get_funnel(level, ids, period)` | Quan tâm → đăng ký → eKYC → đầu tư |
| `get_alerts(date)` | Cảnh báo đang mở |

Kết quả tool là JSON gọn có đơn vị và mốc `as_of`; dữ liệu cá nhân khách hàng bị che.

| Hạng mục | Đề xuất |
|---|---|
| Model | Mặc định `claude-opus-5-5` ($4 / $20 mỗi triệu token vào/ra). Lựa chọn rẻ hơn (do lãnh đạo quyết): `claude-sonnet-5-5` ($2 / $10) hoặc `claude-haiku-5-5` ($0,10 / $0,50). Dù chọn gì nên bỏ `claude-haiku-4-5` ($1 / $5): Haiku 5.5 mới hơn và rẻ hơn |
| Tham số | `thinking: {type: "adaptive"}` (Opus 5.5 không tắt được thinking); `output_config.effort` đặt rõ `medium` cho hỏi đáp, `high` cho phân tích tuần; `tool_choice: auto` (Opus 5.5 không nhận `any`/`tool`); `strict: true` trên tool; xử lý `stop_reason: "refusal"` (bật `fallbacks: "default"`, beta) |
| Vòng lặp | Tool Runner của SDK (`client.beta.messages.toolRunner` + `betaZodTool`) hoặc tự viết loop **cộng dồn đủ lịch sử**; tối đa 8 lượt tool, có timeout |
| Streaming | `client.messages.stream()` → SSE về web/app; hiện trạng thái "đang tra cứu: bảng KPI TTKD HN…" |
| Prompt caching | `tools` + `system` cố định; **không** đưa ngày giờ vào system prompt (đưa "hôm nay là …" vào tin nhắn người dùng) để cache trúng |
| Nhật ký | `ai_query_log`: người hỏi, câu hỏi, tool + tham số, token, thời gian, chi phí ước tính; cảnh báo truy vấn bất thường |
| Slide giao ban | Số liệu lấy **trực tiếp** từ scorecard (không qua AI); AI chỉ viết nhận định theo JSON schema cố định (điểm sáng, điểm yếu, nguyên nhân có dẫn số, đề xuất theo TTKD) qua structured outputs; dựng PPTX bằng template cố định (`pptxgenjs` phía server); lưu vào Ổ file nội bộ + push lãnh đạo |
| Kiểm thử chất lượng | Bộ 30–50 câu hỏi thật của lãnh đạo kèm đáp án tính tay từ bảng KPI; chạy lại mỗi khi đổi prompt/tool/model |
| Dữ liệu gửi lên API | Chỉ số liệu tổng hợp + tên nhân sự/đơn vị; không gửi SĐT/CCCD khách. Theo điều khoản thương mại của Anthropic, dữ liệu API mặc định không dùng để huấn luyện mô hình |

Chi phí ước tính (thô — đo lại bằng `usage` thực tế sau pilot): mỗi câu hỏi ≈ 2–4 lượt gọi model, ~25–35 nghìn token vào (phần lớn được cache) + 2–4 nghìn token ra.

| Model | ~USD/câu | 2.000 câu/tháng (~10 lãnh đạo × 10 câu × 20 ngày) |
|---|---|---|
| Opus 5.5 | 0,08–0,12 | ~160–240 USD |
| Sonnet 5.5 | 0,04–0,06 | ~80–120 USD |
| Haiku 5.5 | 0,003–0,005 | ~6–10 USD |

Slide tuần + bản tin ngày: dưới 10 USD/tháng với bất kỳ model nào.

## 5. Lộ trình triển khai

### 5.0 Bản nhanh 2 ngày: chiều–tối 12/11 và sáng 13/11/2026 (làm trước, thay phần cốt lõi của tuần 1–2)

Mục tiêu: Sale TIKLUY nộp báo cáo ngày trên web, lãnh đạo xem tổng hợp theo cây đơn vị **Khối → Chi nhánh → TTKD (HN1, HN2…) → Sale**
(ngày / lũy kế tháng / lũy kế năm / % HT), cộng dồn ở mọi cấp theo đúng cây Phòng ban trên HRM. Nhánh code: `feat/crm-daily-report`.

| Thời gian | Việc | Ghi chú |
|---|---|---|
| **12/11 chiều–tối — API** | Ghi nhận KPI bất biến theo `CRM-DAILY-REPORT-FLOWS.md` mục 4: `kpi_cif` (khách), `kpi_attribution` (khoản đầu tư, mọi kỳ hạn), `original_ref_code`, Sale phụ trách đại lý + script backfill. Module `daily-report` (TS): `daily_report` (Sale, TTKD, kế hoạch, kết quả, giải trình); `kpi_plan` (KH năm/tháng theo Sale, bộ chỉ tiêu TTKD/PRIORITY) + script nạp KH từ file JSON; số tự động TIKLUY: Đầu tư, CIF, KH mới có giao dịch, Telesale (OMICall, nghe máy ≥ 20 giây), Tuân thủ; endpoint `GET /daily-reports/me`, `PUT /daily-reports/me/plan`, `PUT /daily-reports/me/result`, `GET /daily-reports/summary`; quyền `daily_report.submit`, `daily_report.view` (toàn công ty / đơn vị mình quản lý gồm cấp dưới / chỉ mình); cron push nhắc 08:45 và 16:30 (T2–T7); test | Trễ/thiếu tính lúc đọc (kế hoạch sau 09:30, kết quả sau 17:30 = trễ; báo cáo đã nộp khoá sau 17:30) — chưa cần cron chốt sổ |
| **Song song (bạn)** | Chuẩn bị dữ liệu ở `CRM-DAILY-REPORT-FLOWS.md` mục 9: dựng cây Chi nhánh → TTKD HN1, HN2… trên HRM, xếp Sale TIKLUY vào đúng 1 TTKD, gán người phụ trách; mã NV + KH năm 4 người pilot; Sale phụ trách từng đại lý | Chạy `scripts/surveyKpiOrgAssignment.ts` để soát |
| **13/11 sáng — Web + đưa lên** | Màn Đại lý: chọn Sale phụ trách; đổi nhãn loại phòng ban TTKD; màn "Báo cáo ngày" (Sale: kế hoạch, kết quả, số tự động chỉ đọc, "cần đạt hôm nay"); màn "Tổng hợp báo cáo ngày" (lãnh đạo: chọn ngày, cây đơn vị mở xuống từng Sale, tình hình nộp, KH / TH ngày, lũy kế tháng, lũy kế năm, % HT năm, còn thiếu, xuất Excel); menu "Báo cáo & Phân tích"; deploy test → seed quyền + KH → kiểm tra bằng 1 tài khoản Sale + 1 tài khoản lãnh đạo → live | Sale dùng web trên trình duyệt điện thoại |

Khác thiết kế đầy đủ: số tự động **tính trực tiếp lúc xem** (dữ liệu TIKLUY còn nhỏ, vài nghìn khách) thay vì bảng `kpi_daily_fact`.
Các hàm tính viết theo registry ở mục 4.1 nên khi thêm bảng fact (cho AI, tuần 5) chỉ cần job gọi lại đúng các hàm đó — vẫn một cách tính.

**Không có trong bản 2 ngày** (làm tiếp theo lộ trình tuần bên dưới): app, trợ lý AI, GPS + ảnh, màn cấu hình KPI/import Excel,
cảnh báo/vinh danh, điều chỉnh sau chốt, điểm KPI có trọng số, tiền ra/tái tục, các chỉ tiêu nhập tay theo danh sách định danh.

**Cần có trước khi bắt đầu** (thiếu thì dùng mặc định, sửa sau được):

| Cần | Mặc định nếu chưa có |
|---|---|
| Mã NV 4 người pilot + TTKD của họ | Code xong vẫn chạy được, nạp người sau |
| KH năm từng người | Lấy số trong file Excel đã gửi (TTKD; Priority Chi + Tủn; Priority Hoa Anh), đơn vị đồng |
| Định nghĩa Đầu tư | Tiền vào (gross), theo Sale hưởng hoa hồng `commission.sale_id` |
| Định nghĩa CIF | Khách đăng ký mới có mã Sale, theo ngày đăng ký |
| Sale đã thuộc đúng TTKD trên HRM | Bắt buộc — nếu chưa, gán trên web HRM › Phòng ban trước ngày 2 |

### 5.1 Lộ trình đầy đủ theo tuần

Nhân lực: **1 dev + Claude**, phạm vi **TIKLUY**. Mỗi hạng mục: Claude viết code + test (jest có sẵn) theo convention DDD của dự án →
dev review, chạy trên môi trường test (Dokploy) → nghiệm thu với người pilot → deploy live. Vì làm tuần tự API → web → app nên
**web đi trước**: 2 tuần đầu Sale pilot báo cáo trên web (kể cả mở bằng trình duyệt điện thoại), app vào từ tuần 3.

| Tuần | Thời gian | Nội dung | Kết quả |
|---|---|---|---|
| 0 | 13–15/11 | Chốt câu hỏi chặn (mục 6.1 #1–5, #15, #29); chạy `scripts/surveyKpiOrgAssignment.ts` để kiểm tra Sale ↔ TTKD và sửa dữ liệu; gửi đề nghị TIKLUY (tiền ra) | Đặc tả + dữ liệu đơn vị sạch |
| 1 | 16–20/11 | API: module `sales-kpi` (mở rộng `kpi_metric`, bộ KPI, hồ sơ, kế hoạch — seed bằng script cho 4 người pilot); số tự động TIKLUY: Đầu tư, CIF, KH mới có giao dịch, Telesale, Tuân thủ; backfill từ 01/01/2026 | Số liệu Sale × ngày × TTKD |
| 2 | 23–27/11 | API: module `daily-report` (kế hoạch/kết quả, chốt sổ, cron nhắc); scorecard 13 cột theo công ty/TTKD/Sale + xuất Excel. Web: Báo cáo ngày của tôi, Tổng hợp nộp báo cáo, Bảng KPI theo TTKD | **Pilot trên web từ 30/11** |
| 3 | 30/11–04/12 | App: màn báo cáo ngày + push nhắc; thêm camera vào bản build native và gửi duyệt store sớm. Web: cấu hình KPI + import Excel "Khung KPI" | Sale báo cáo trên app |
| 4 | 07–11/12 | Xếp hạng + heatmap TTKD, cảnh báo + vinh danh, điều chỉnh sau chốt, CTV gắn Sale, KH quan tâm theo SĐT + phễu | Đánh giá TTKD đầy đủ |
| 5 | 14–18/12 | Trợ lý AI: module `ai-assistant`, 8 tool, streaming, nhật ký, bộ câu hỏi kiểm thử; sửa AI chat cũ | Lãnh đạo dùng AI |
| 6 | 21–25/12 | Ghi nhận thực địa GPS + ảnh (app), bằng chứng tin nhắn; slide giao ban + bản tin 17:45; tiền ra / NET / tái tục nếu TIKLUY đã gửi sự kiện | Đủ chỉ tiêu TIKLUY |
| 7 | 28/12/2026–04/01/2027 | Hiệu chỉnh sau pilot, nhập KPI 2027 cho toàn bộ TTKD TIKLUY, hướng dẫn sử dụng | Toàn TTKD TIKLUY từ 04/01/2027 |
| Sau | Từ 01/2027 | Mở rộng VNFITE (Gọi vốn, cho vay FE Credit), các nhóm chức danh còn lại | |

Lịch trên chưa có đệm cho lỗi phát sinh, hỗ trợ pilot hằng ngày và việc khác của dev. Nếu trễ: giữ nguyên thứ tự tuần 1–4
(pilot + đánh giá TTKD là phần lãnh đạo dùng hằng ngày) và lùi AI (tuần 5) trước.

**Trong lúc chờ MVP**: 4 người pilot (bắt đầu từ 06/11) báo cáo bằng file Excel đúng các cột của hệ thống; khi go-live chạy script nhập bù
số nhập tay 06/11–27/11 để lũy kế tháng 11 đầy đủ (số tự động được backfill sẵn).

## 6. Thông tin cần để hoàn thiện

### 6.1 Ban kế hoạch / Kinh doanh — chặn tuần 1–2

1. Danh sách 4 nhân sự pilot (mã NV, đơn vị, nhóm chức danh) + **Quyết định giao KPI** từng người; KH theo tháng/quý nếu có.
2. Mẫu báo cáo ngày đang dùng (Excel/Zalo) để không bỏ sót trường.
3. Đơn vị KH tiền: 250.000.000 có phải 250 triệu đồng? KH 800 triệu của "Chi + Tủn" là chung hay mỗi người?
4. **"Đầu tư" và "Gọi vốn" khác nhau thế nào?** (giả thuyết: Đầu tư = TIKLUY, Gọi vốn = VNFITE). Doanh số tính tiền vào hay NET?
   Tái tục có tính là doanh số mới? Gán Sale theo người hưởng hoa hồng hay Sale đang phụ trách khách?
5. CIF = khách đăng ký hay eKYC thành công? Có tính khách dưới 18 tuổi? "CIF KH mới có giao dịch": khách phải đăng ký trong kỳ, hay chỉ cần giao dịch đầu tiên trong kỳ?
6. Tỷ lệ tái tục: theo tiền hay số khoản; mẫu số = các khoản đáo hạn trong kỳ?
7. Merchant sale / Merchant Active: merchant là gì, "active" định nghĩa thế nào, có hệ thống nguồn không? Merchant Active có tính điểm?
8. CTV có phải là đại lý cá nhân trên hệ thống? Ai được tính là người phát triển?
9. Cuộc hẹn tư vấn: cần bằng chứng gì (gặp trực tiếp có GPS/ảnh, hẹn online)? KH năm bao nhiêu?
10. Telesale: đếm mọi cuộc gọi ra hay chỉ cuộc nghe máy ≥ 20 giây? Có tính điểm?
11. Roadshow, Other: bằng chứng bắt buộc là gì; có tính điểm?
12. Tính tuân thủ: chỉ tính nộp báo cáo đúng hạn, hay cộng cả SLA 183A và vi phạm quy định khác?
13. Trần % HT khi tính điểm tổng (100%, 120% hay không trần)?
14. Phân bổ KH năm → tháng: chia đều hay theo tỷ trọng?
15. BBH nói "sáu nhóm chức danh" nhưng bảng chỉ liệt kê 5 — nhóm thứ sáu là gì, mỗi nhóm dùng bộ chỉ tiêu nào?
16. Giờ nộp kế hoạch, giờ chốt sổ; thứ Bảy có báo cáo không?
17. Ai duyệt điều chỉnh sau chốt; ai được xem báo cáo của ai.
18. BBH mục 2.3: "mở Ship" là gì; "lượt tải ứng dụng" đo bằng gì; VNFITE có dữ liệu dư nợ cho vay ngoài lead FE Credit không?
29. **Đánh giá theo trục nào**: TTKD trong cây tổ chức (đề xuất) hay danh mục "Chi nhánh" HRM? Danh sách TTKD/chi nhánh thực tế của TIKLUY
    (có "Trung tâm Hà Nội 1, 2…" không), ai phụ trách từng TTKD; nhân sự Priority thuộc TTKD-PRIORITY hay TTKD Hà Nội 1?

### 6.2 Lãnh đạo

19. Danh sách người dùng Trợ lý AI; 20–30 câu hỏi hay hỏi nhất (làm bộ kiểm thử).
20. Mẫu slide giao ban tuần hiện tại.
21. Ngân sách AI/tháng và chọn model (mục 4.6); đồng ý gửi số liệu tổng hợp + tên nhân sự lên Claude API.
22. Ngưỡng cảnh báo và tiêu chí vinh danh.

### 6.3 TIKLUY / hệ thống lõi

23. Gửi sự kiện đáo hạn / tất toán trước hạn / tái tục (ngày, gốc, lãi, khoản tái tục mới) có retry; bật bulk sync đêm.
24. VNFITE có đẩy khoản "gọi vốn" qua `/investments/upsert` (`app_code=vnfite`) không?
25. Nguồn dữ liệu đại lý/CTV có thông tin người phát triển không?

### 6.4 Khối Công nghệ

26. API key Anthropic (tổ chức, hạn mức chi tiêu), biến môi trường test/live trên Dokploy.
27. 4 người pilot đã có máy nhánh OMICall chưa (`sale_omicall_profile`) — chưa có thì Telesale = 0.
30. Chạy `npx ts-node --transpile-only scripts/surveyKpiOrgAssignment.ts --app=tikluy` (chỉ đọc, chỉ đếm) trên DB live: cho biết TTKD nào
    có bao nhiêu Sale/khách/doanh số, Sale nào chưa thuộc TTKD hoặc thuộc nhiều TTKD, chi nhánh nào chưa gán — sửa dữ liệu trước go-live.
28. Lịch build và duyệt app store cho bản có camera.

## 7. Đề xuất nâng cấp

1. **Auto-first, nhập tay theo danh sách**: không cho nhập con số trơn với chỉ tiêu có định danh → thời gian nhập < 3 phút/ngày, loại khai khống.
2. **Kế hoạch ngày do hệ thống gợi ý** ("cần đạt" + KH ưu tiên từ đáo hạn, hàng đợi 183A, KH quan tâm), nối thẳng sang "Khách cần xử lý"
   và gọi OMICall một chạm — báo cáo trở thành công cụ làm việc thay vì nghĩa vụ.
3. **Tiến độ thời gian & "cần đạt mỗi ngày"** trên mọi bảng: nhìn màu là biết ai chậm, không cần đọc số.
4. **Phễu theo SĐT** (quan tâm → đăng ký → eKYC → đầu tư) + thời gian chuyển đổi: đo được hiệu quả roadshow/tờ rơi.
5. **Bản tin AI 17:45** cho từng quản lý: ai chưa nộp, điểm nổi bật, giải trình đáng chú ý của đơn vị mình.
6. **AI phát hiện bất thường**: số nhập tay lệch mạnh so với hoạt động trên hệ thống (vd báo 5 cuộc hẹn nhưng 0 check-in), ảnh trùng, GPS lặp → danh sách cần kiểm tra.
7. **Tuân thủ tự tính** từ dữ liệu nộp báo cáo + SLA 183A: chỉ tiêu 10% này không cần ai chấm tay.
8. **Một nguồn số duy nhất** (`kpi_daily_fact`) cho dashboard, Excel, AI, slide — về sau dùng tiếp cho tính thưởng KPI và hoa hồng.
9. **Nâng cấp AI hiện có** ở tuần 5: model mới, sửa vòng lặp tool, streaming, kiểm quyền ở UI, bỏ nhánh Gemini không chạy tool.
10. **Đồng bộ một chiều + đối soát** thay cho "hai chiều" để an toàn cho dữ liệu lõi.
11. Sau 2 tuần pilot đo: tỷ lệ nộp đúng hạn, thời gian nhập trung bình, chênh lệch số tự động so với Excel cũ, số cờ bất thường → căn cứ nhân rộng (BBH 2.4).

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Thiếu tiền ra → NET, tái tục sai | Gắn nhãn "chưa gồm tiền ra" cho chỉ số NET đến khi TIKLUY gửi sự kiện; chưa tính điểm tái tục khi thiếu dữ liệu |
| Định nghĩa chỉ tiêu chưa chốt → làm lại | Chốt ở tuần 0; chỉ tiêu nào chưa chốt chạy dạng nhập tay, không chặn MVP |
| Bản app có camera phải chờ duyệt store | Đưa cấu hình camera vào bản build tuần 3 |
| Pilot đã bắt đầu 06/11 nhưng chưa có hệ thống | Excel đúng cột hệ thống; script nhập bù khi go-live |
| AI trả lời sai số | Chỉ đọc qua tool trên bảng fact; slide lấy số trực tiếp; bộ câu hỏi kiểm thử; hiển thị nguồn + thời điểm cập nhật |
| Lộ dữ liệu khách qua AI/xuất file | Tool áp scope theo quyền người hỏi, che SĐT/CCCD, nhật ký truy vấn + cảnh báo bất thường, xuất file ghi `data_export_log` |
| Sale ngại nhập | Auto-first, gợi ý sẵn, nhập trên app ≤ 3 phút, nhắc đúng giờ |
