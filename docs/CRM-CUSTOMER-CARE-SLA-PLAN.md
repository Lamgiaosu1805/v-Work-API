# Phân bổ khách & SLA chăm sóc cho Sale — Kế hoạch triển khai (Quy định 183A, giai đoạn 1)

> Trạng thái: **ĐÃ DUYỆT 06/10/2026 — API đã làm xong (nhánh `feat/crm-customer-care`, 07/10/2026)**.
> Web + App chưa làm. Xem mục 10 "Đã triển khai (API)".
> Căn cứ: Quy định 183A/2026/QĐ-TGĐ (hiệu lực 11/09/2026) + phân tích gap ngày 06/10/2026.

## 0. Phạm vi đã chốt với chủ hệ thống

| Quyết định | Nội dung |
|---|---|
| Đối tượng | **Chỉ khách đã đăng ký app** (bỏ phần Lead marketing chưa đăng ký). Làm **TIKLUY trước**, bật theo `app_code` để mở rộng VNFITE sau |
| Vào kho chung (Pool) | **Chỉ khách marketing** = đăng ký không có mã Sale/đại lý (`referred_by = null`, `agent_id = null`). Khách có mã Sale vẫn thuộc Sale đó nhưng **vẫn bị tính SLA chăm sóc** |
| Nhóm ưu tiên | **Theo trạng thái**, tự đổi khi trạng thái đổi: A = đã eKYC chưa đầu tư; B = mới đăng ký chưa eKYC; C = 2 vòng Sale chưa chuyển đổi → CSKH nuôi dưỡng |
| Yêu cầu nhận khách | **Giữ** yêu cầu nhận khách 4h (Sale chứng minh khách do mình giới thiệu). **Bỏ** "đợt nhận khách" (claim period, ai nhanh người đó được) — thay bằng phân tự động |
| Giờ SLA | **Giờ làm việc** (T2–T6, 8:00–17:00, trừ ngày lễ trong `HolidayModel`). Khách vào ngoài giờ được phân đầu ca kế tiếp |
| Hoa hồng | **Theo người đang giữ** tại thời điểm phát sinh (eKYC/đầu tư). Thu hồi **không** lấy lại hoa hồng đã phát sinh (giống `reassignCustomer` hiện tại) |

Vì hoa hồng theo người đang giữ, `Customer.referred_by` tiếp tục là "Sale phụ trách hiện tại" — **không tách field mới**, không phải sửa data scope `CUSTOMER_SELF_ASSIGNED`, hoa hồng, investment scope.

## 1. Dữ liệu từ TIKLUY (xác nhận với session TIKLUY ngày 06/10/2026)

- Đăng ký → `POST /customer/upsert` realtime (async, **không retry**). SĐT dạng `0xxxxxxxxx`. Không gửi `registeredAt` → dùng thời điểm nhận.
- eKYC → `POST /customer/upsert` lần 2 có `full_name`, `id_number`, `date_of_birth`...
- Đầu tư mới/đầu tư thêm → `POST /investments/upsert` (không có status). **Không có** sự kiện tất toán/tái tục.
- Lưu lượng nền: ~12–13 đăng ký/ngày, ~3/4 không mã → **~10 khách/ngày vào Pool**. Đợt CTKM 30/09–06/10: ~160/ngày, 88% là khách giới thiệu khách (mã UUID → vWork hiểu là marketing → vào Pool).
- ~43% CIF đợt CTKM **dưới 18 tuổi** → cần chốt có phân nhóm này cho Sale không (mục 9).

⇒ "Chuyển đổi" giai đoạn 1 = **khách có khoản đầu tư đầu tiên** (sự kiện `investments/upsert`). Doanh số theo Sale chưa tin cậy được cho tới khi TIKLUY gửi trạng thái khoản đầu tư + retry.

## 2. Quy tắc nghiệp vụ

### 2.1 Nhóm & SLA (giá trị mặc định, cấu hình được trong `CustomerCarePolicy`)

| Nhóm | Điều kiện | Liên hệ lần đầu | Cảnh báo | Thu hồi nếu chưa liên hệ | Không hoạt động hợp lệ → thu hồi | Tần suất tối thiểu nếu chưa kết nối |
|---|---|---|---|---|---|---|
| A | `kyc_verified`, chưa có đầu tư | ≤ 5 phút | phút 15 | phút 30 | 1 ngày làm việc ≈ 24h (trừ khi có lịch hẹn còn hiệu lực) | 3 lần / 24h |
| B | `registered` (chưa eKYC) | ≤ 15 phút | phút 15 | phút 60 | 2 ngày làm việc ≈ 48h (trừ lịch hẹn) | 3 lần / 48h |
| C | ≥ 2 vòng Sale chưa chuyển đổi | Không SLA Sale — vào hàng đợi CSKH | — | — | — | — |

- Mọi mốc tính bằng **phút làm việc** từ `assigned_at` (đồng hồ dừng ngoài giờ/ngày lễ).
- Khách B eKYC trong lúc đang được giao → đổi sang A; các mốc **chưa qua** được tính lại theo A từ thời điểm đổi (không phạt hồi tố).
- Khách đã có đầu tư → `converted`: kết thúc lượt giao, ngừng SLA (khách vẫn thuộc Sale, chuyển sang chăm sóc sau bán — giai đoạn sau).
- Khách có mã Sale (không qua Pool): có lượt giao kênh `referral`, áp **cảnh báo** SLA như trên nhưng **không tự thu hồi** (chỉ báo cáo vi phạm + quản lý thu hồi tay) — vì đây là khách của Sale.

### 2.2 "Liên hệ" và "hoạt động hợp lệ" (Điều 3.3)

- **Liên hệ lần đầu** = cuộc gọi ra qua OMICall của đúng Sale được giao, tới SĐT khách, sau `assigned_at` (kể cả không nghe máy).
- **Hoạt động hợp lệ** = một trong:
  1. Cuộc gọi kết nối với `answer_sec ≥ 20s` (cấu hình) — loại "gọi nháy máy";
  2. Báo cáo chăm sóc đủ 4 trường bắt buộc (Điều 7.2): **kết quả liên hệ, nhu cầu khách, trạng thái hiện tại, bước tiếp theo**.
- Chỉ mở chi tiết khách, ghi chú tự do, cuộc gọi < ngưỡng **không** được tính.
- Lịch hẹn (`appointment_at`) trong tương lai ⇒ miễn thu hồi do không hoạt động cho tới khi quá hẹn + 2h làm việc.

### 2.3 Phân bổ tự động (bản tối giản của Điều 5–6)

Giai đoạn 1 chưa có điểm hiệu suất ⇒ mọi Sale coi như **hạng C**, phân **chia đều (round-robin)**. Kênh 50/40/10 + hạng A/B/C/D làm ở giai đoạn 2.

Sale **đủ điều kiện** nhận khách khi đồng thời:
- có role `CRM_SALE` hoặc `CRM_SALE_TEAM_LEAD` (qua `listEmployeesByRoleCodes`), account không bị xoá, chưa có `resignation_date` ≤ hôm nay;
- `SaleAllocationProfile.status = open` (quản lý có thể **tạm dừng** kèm lý do + thời hạn, hoặc **khoá**);
- không nghỉ phép / vắng trong ngày (đọc đơn nghỉ đã duyệt);
- chưa chạm hạn mức ngày (mặc định hạng C): **≤ 10 khách mới/ngày** và **tổng khách đang phải xử lý ≤ 50**. Chạm hạn mức → trạng thái **"Đủ"**, khách tiếp theo sang Sale khác;
- không phải Sale đã từng giữ khách này (tránh phân lại Sale cũ).

Không ai đủ điều kiện → khách nằm lại Pool, dashboard báo "Pool tồn".

Thứ tự lấy khách từ Pool: nhóm A trước B, cũ trước mới. Phân chạy **mỗi phút trong giờ làm việc**, có Redis lock + `$inc` có điều kiện để không vượt hạn mức khi chạy song song.

### 2.4 Thu hồi & phân lại (Điều 8)

| Trường hợp | Cách xử lý |
|---|---|
| Không liên hệ lần đầu đúng SLA (A phút 30, B phút 60) | Tự động |
| Không hoạt động hợp lệ 24h (A) / 48h (B), không có lịch hẹn | Tự động |
| Sale nghỉ việc / bị khoá nhận khách | Tự động (job hằng ngày + khi chạy workflow chuyển nhân sự) |
| Giữ khách, khai sai, gian lận | Quản lý thu hồi tay, **bắt buộc lý do** |

Thu hồi = kết thúc lượt giao (`ended_reason`), `referred_by = null`, **giữ nguyên** hoa hồng đã phát sinh và `source_type` (sửa lỗi hiện tại đặt `null`), ghi `CustomerInteraction` type `reassigned`, khách về Pool với `round + 1`.
**Sau vòng Sale thứ 2** chưa chuyển đổi → nhóm C, chuyển hàng đợi **CSKH nuôi dưỡng** (không phân tự động cho Sale nữa; quản lý/CSKH đưa về Pool khi khách có nhu cầu mới).

### 2.5 Thông báo

| Sự kiện | Người nhận | Kênh |
|---|---|---|
| Được giao khách | Sale | push + socket (ưu tiên cao với nhóm A) |
| Cảnh báo SLA | Sale + trưởng nhóm | push + socket |
| Bị thu hồi | Sale + trưởng nhóm | push |
| Pool tồn không có Sale nhận | Quản lý CRM | push (tối đa 1 lần/30 phút) |

## 3. Thiết kế kỹ thuật (API)

### 3.1 Module mới `src/modules/customer-care/` (TypeScript, DDD/Hexagonal)

```
domain/
  customer-assignment.entity.ts   # lượt giao + máy trạng thái SLA (thuần, không Mongoose)
  care-policy.ts                  # tính nhóm A/B/C, deadline theo phút làm việc
  working-calendar.ts             # cộng phút làm việc, bỏ ngoài giờ/ngày lễ
  sale-allocation-profile.entity.ts
infrastructure/                   # repository + mapper cho 4 model dưới
application/
  allocate-from-pool.service.ts   # chọn Sale theo round-robin + hạn mức
  record-care-activity.service.ts # đánh giá hoạt động hợp lệ, cập nhật mốc
  sweep-sla.service.ts            # cảnh báo / thu hồi
  revoke-assignment.service.ts
  list-*.service.ts               # đọc (CQRS-lite)
interface/                        # routes /customer-care/*
```

Model mới (mỗi model 1 owner là module này):

| Model | Collection | Vai trò |
|---|---|---|
| `CustomerAssignmentModel` | `customer_assignment` | 1 bản ghi / lượt giao: `customer_id, app_id, sale_id, round, channel (auto/manual/referral/claim), priority_class, assigned_at, assigned_by, first_contact_due_at, warn_at, revoke_at, inactivity_due_at, first_contact_at, last_valid_activity_at, attempt_count, warned_at, status (active/ended), ended_at, ended_reason` |
| `CustomerCareStateModel` | `customer_care_state` | 1 bản ghi / khách: `pool_status (in_pool/assigned/nurturing/converted/excluded), priority_class, round_count, current_assignment_id, previous_sale_ids, entered_pool_at` |
| `SaleAllocationProfileModel` | `sale_allocation_profile` | `sale_id, status (open/paused/locked), reason, until, set_by, rank (mặc định C), cap_new_per_day, cap_total, last_assigned_at` |
| `CustomerCarePolicyModel` | `customer_care_policy` | cấu hình theo `app_code`, có `version` + `effective_from`: bật/tắt, SLA từng nhóm, ngưỡng giây gọi hợp lệ, hạn mức theo hạng, giờ làm việc |

`Customer` (code cũ) **không thêm field**. `CustomerInteractionModel` (code cũ) thêm field cho báo cáo chăm sóc: `contact_result`, `customer_need`, `current_status`, `next_step`, `appointment_at`, `lost_reason`, `call_log_id`, `assignment_id`, `is_valid_activity`.

### 3.2 Workflows (xuyên module)

| Workflow | Gọi từ | Việc |
|---|---|---|
| `enter-customer-care.workflow.ts` | `CustomerController.upsert` (sau commit) | Khách TIKLUY mới không mã → Pool; có mã Sale → lượt giao `referral`; eKYC → đổi nhóm B→A |
| `allocate-pool.workflow.ts` | cron mỗi phút | lấy Sale ứng viên (permission + leave) → `customer-care.allocate` → cập nhật `referred_by` → thông báo |
| `sweep-customer-care-sla.workflow.ts` | cron mỗi phút | cảnh báo / thu hồi / chuyển CSKH |
| `record-call-care-activity.workflow.ts` | event cuộc gọi từ `customer-call` | gắn cuộc gọi vào lượt giao, tính liên hệ lần đầu / hoạt động hợp lệ |
| `convert-customer-on-investment.workflow.ts` | `InvestmentController.upsert` | khoản đầu tư đầu tiên → `converted` |
| `offboard-sale-customers` | mở rộng `reassign-sale-customers` / job hằng ngày | Sale nghỉ việc/bị khoá → trả khách về Pool |

`customer-care` cần phát event `CallLogRecorded` từ module `customer-call` (hiện chưa có domain event nào).

### 3.3 Endpoint mới `/customer-care`

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/my-queue` | `customer_care.view` (SELF) | Khách đang giao cho tôi + đếm ngược SLA, sắp theo hạn |
| GET | `/assignments` | `customer_care.manage` | Danh sách lượt giao, lọc Sale/trạng thái/vi phạm |
| GET | `/pool` | `customer_care.manage` | Pool + hàng đợi CSKH |
| POST | `/customers/:id/assign` | `customer_care.manage` | Phân tay (thay thế dần `/customer/:id/assign`) |
| POST | `/customers/:id/revoke` | `customer_care.manage` | Thu hồi tay, bắt buộc lý do |
| POST | `/customers/:id/return-to-pool` | `customer_care.manage` | CSKH đưa khách nuôi dưỡng về Pool |
| GET/PATCH | `/sales/:saleId/allocation` | `customer_care.manage` | Tạm dừng / khoá / mở, hạn mức riêng |
| GET | `/dashboard` | `customer_care.manage` | Pool tồn, đang xử lý, quá SLA, thu hồi, tỷ lệ liên hệ đúng hạn theo Sale |
| GET/PUT | `/policy` | `customer_care.policy` (CRM/IT) | Cấu hình SLA, hạn mức, ngưỡng |

Permission mới seed vào `seedPermissionCrmRoles.ts`: Sale/Team lead `customer_care.view` (SELF/OWN_DEPARTMENT), Sale manager `customer_care.manage`, admin `customer_care.policy`.

### 3.4 Cron

`src/jobs/customerCareJob.js` — mỗi phút: allocate + sweep (Redis lock `customer-care:sweep`, idempotent, dựa trên mốc lưu DB có index). 00:05 hằng ngày: rà Sale nghỉ việc/khoá, reset bộ đếm ngày.

## 4. Sửa lỗi nền (làm cùng đợt)

1. Bật lại `GET/POST /customer/interactions/:externalId` — sửa `CustomerInteractionController` truyền `req.permissionAbility` (đang truyền `req.account`), dùng `requirePermission("customer_interaction.*")`, bắt buộc 4 trường khi khách đang có lượt giao. *Route này bị comment ở commit `0476e69` — cần xác nhận với người comment.*
2. Sự kiện socket: web nghe `customer_call:ended`, API phát `customer_call:rate` → thống nhất `customer_call:ended` (giữ phát cả `rate` 1 thời gian cho app cũ).
3. `CustomerClaimRequestController.revoke` đặt `source_type: null` → giữ nguyên nguồn gốc.
4. Xuất Excel khách: thêm quyền `customer.export` (seed cho manager), ghi log người xuất.
5. Ẩn menu/route "đợt nhận khách" (claim period) — giữ code, tắt route tạo đợt mới.

## 5. Web & App (sau khi API xong)

**Web (`vWork-website`)**
- Quản lý: màn **"Phân bổ khách"** (Pool, lượt giao đang chạy, vi phạm SLA, thu hồi/phân tay), màn **cấu hình Sale nhận khách** (mở/tạm dừng/khoá), **dashboard vận hành** v1, màn **cấu hình chính sách** (CRM/IT).
- Sale: **"Khách cần xử lý"** có đếm ngược SLA; form chăm sóc bắt buộc mở sau cuộc gọi (sửa `CallEndNoteModal`).

**App (`vWork`)** — bắt buộc vì Sale làm việc trên điện thoại, SLA 5 phút:
- Màn **"Khách cần xử lý"** + push khi được giao/cảnh báo; form chăm sóc sau cuộc gọi; thêm named flag mới vào `getPermissions()` và `usePermissions.js` đồng thời.

## 6. Kiểm thử

- Unit (jest, có sẵn `__tests__`): `working-calendar` (qua đêm, cuối tuần, lễ), `care-policy` (đổi nhóm B→A), entity assignment (mốc SLA, thu hồi, vòng 2 → C), chọn Sale (hạn mức, loại Sale cũ, Sale nghỉ).
- Tích hợp: upsert khách → vào Pool → cron phân → giả lập webhook OMICall → liên hệ hợp lệ; không gọi → cảnh báo → thu hồi → phân Sale khác.
- Chạy thử trên môi trường **test** với policy `enabled=false` (chỉ ghi nhận, không phân) 2–3 ngày để đo, rồi mới bật.

## 7. Triển khai & chuyển tiếp

1. Deploy với `enabled=false` cho TIKLUY: hệ thống chỉ tạo `customer_care_state` cho khách mới, chưa phân.
2. Script backfill: khách TIKLUY chưa có Sale và chưa đầu tư → Pool (chỉ khách đăng ký trong 30 ngày gần nhất — cần chốt); khách đang có Sale → **không** tạo lượt giao hồi tố.
3. Bật `enabled=true` sau khi web/app có màn "Khách cần xử lý".

## 8. Ước lượng

| Hạng mục | Effort |
|---|---|
| Sửa lỗi nền (mục 4) | 2–3 ngày |
| API module + workflows + cron + test | 2–2,5 tuần |
| Web (quản lý + Sale) | 1,5 tuần |
| App (hàng đợi + push + form) | 1–1,5 tuần |

## 9. Cần chốt thêm (không chặn việc làm API)

1. **Khách dưới 18 tuổi** (biết được sau eKYC): loại khỏi Pool hay vẫn phân?
2. Ngưỡng cuộc gọi hợp lệ: 20 giây có phù hợp?
3. Backfill: đưa khách marketing đăng ký trong bao nhiêu ngày gần nhất vào Pool?
4. Đề nghị phía TIKLUY (không chặn giai đoạn 1): gửi `register_source` + `registered_at` lúc đăng ký; gửi sự kiện trạng thái khoản đầu tư (matured/early_terminated/renewed) **có retry**; bật bulk sync định kỳ làm lưới đối soát.
5. Giai đoạn 2 (sau khi có dữ liệu thật ≥ 2 tuần): điểm hiệu suất 7 ngày, hạng A–D, quota 130/110/100/70, kênh 50/40/10, KPI, báo cáo funnel, biểu mẫu Phụ lục 01.

## 10. Đã triển khai (API) — 07/10/2026

### Code mới
- Module `src/modules/customer-care/` (domain thuần + 4 model: `customer_assignment`, `customer_care_state`,
  `sale_allocation_profile`, `customer_care_policy`).
- Workflows: `sync-customer-care`, `allocate-customer-pool`, `sweep-customer-care-sla`,
  `manage-customer-care`, `release-unavailable-sale-customers`, `record-call-care-activity`,
  `list-sale-allocation-overview` (+ `workflows/customer-care/customer-care-support.ts`).
- Cron `src/jobs/customerCareJob.js`: mỗi phút quét SLA + phân Pool (Redis lock); 00:05 thu hồi khách của
  Sale nghỉ việc / bị khoá.
- Route `/customer-care/*` như mục 3.3 (thêm `GET /customers/:id/history`, `POST /customers/:id/exclude`).
- Module `customer-call` phát `CallLogEndedDomainEvent` đúng 1 lần / cuộc gọi.
- Test: `__tests__/customerCareDomain.test.ts` (22), `__tests__/customerCareFlow.test.ts` (9, Mongo replica set).

### Quy tắc bổ sung khi code (so với thiết kế)
- Chưa kết nối được nhưng Sale đã gọi đủ số lần tối thiểu (3) → tính là chăm sóc hợp lệ (không thu hồi oan
  khi khách không nghe máy).
- Kênh `claim` (yêu cầu nhận khách được duyệt) xử lý như `referral`: chỉ cảnh báo, không tự thu hồi; Sale bị
  KHOÁ vẫn giữ khách referral/claim, Sale NGHỈ VIỆC thì trả toàn bộ.
- **Đối soát với màn cũ**: gán/chuyển/gỡ Sale ở `/customer/*`, duyệt/huỷ yêu cầu nhận khách → đồng bộ lại lượt
  giao (đổi Sale = kết thúc lượt cũ + mở lượt mới kênh `manual`/`claim`; gỡ Sale = thu hồi về Pool).
- Yêu cầu nhận khách được gửi & duyệt cả khi khách **đang do hệ thống/quản lý phân** (trước đây bị chặn vì
  khách đã có Sale) — để Sale giới thiệu thật vẫn chứng minh được trong cửa sổ 4h.
- "Đợt nhận khách" bị chặn (409, status trả `is_open:false, auto_allocation:true`) **chỉ với app đã bật
  phân tự động**; VNFITE giữ quy trình cũ.
- Khách của đại lý (có `agent_id`, không có Sale) không vào luồng.

### Sửa lỗi nền (mục 4) — đã làm
1. Bật lại `GET/POST /customer/interactions/:externalId` (quyền `customer_interaction.view/create`); sửa
   controller (truyền `ability`, `getCurrentUserInfo` không còn tồn tại). Báo cáo của Sale đang được giao
   khách bắt buộc 4 trường; khách từ chối bắt buộc `lost_reason`.
2. Socket: phát cả `customer_call:ended` (web) và `customer_call:rate` (client cũ), payload thêm `customerId`.
3. Huỷ duyệt yêu cầu nhận khách: `source_type` về `marketing` thay vì `null`.
4. Xuất Excel khách cần quyền `customer.export` + ghi `data_export_log`. ⚠️ **Sale thường mất quyền xuất**
   (trước đây chỉ cần `customer.view`) — chỉ trưởng nhóm (phòng mình) và quản lý Sale có.
5. Schema `customer_interaction.metadata` thêm `approved_by`, `revoked_by`, `claim_request_id`,
   `cif_hh_granted`, `ekyc_hh_granted` (trước đây bị Mongoose loại bỏ → mất dấu người duyệt/huỷ).

### Các bước deploy (theo thứ tự)
1. `npx ts-node scripts/seedPermissionCatalog.ts` → `seedPermissionCrmRoles.ts` → `seedPermissionAdminRole.ts`
   (quyền mới: `customer_care.view/manage/policy`, `customer.export`).
2. `npx ts-node scripts/seedCustomerCarePolicy.ts --app=tikluy` (chế độ chạy thử, `enabled=false`).
3. Deploy API. Từ đây khách TIKLUY mới tự vào Pool (chưa phân).
4. (Tuỳ chọn) `scripts/backfillCustomerCarePool.ts --app=tikluy --days=<N> --dry-run` rồi chạy thật.
5. Sau khi web/app có màn "Khách cần xử lý": `PUT /customer-care/policy/tikluy {"enabled": true}`.

### Chưa làm / còn mở
- Web, App (mục 5); named flag mới cho `usePermissions.js` + `getPermissions()`.
- `/customer/bulk-upsert` (đồng bộ batch, cron phía TIKLUY đang tắt) chưa gọi đồng bộ Pool.
- Thông báo quản lý khi Pool tồn không có Sale nhận (hiện chỉ thấy trên dashboard).
- Xác nhận với phía TIKLUY: khách 13–17 tuổi có luôn đi qua eKYC và gửi `date_of_birth` không (session
  TIKLUY không mở lúc chốt — nếu không gửi thì khách này không được nhận diện ưu tiên thấp).

### Quyết định đã chốt (07/10/2026) — thay cho mục 9.1–9.3
1. **Khách dưới 18 tuổi**: vẫn vào kho nhưng **ưu tiên thấp** — `customer_care_state.low_priority = true`
   khi ngày sinh eKYC < 18 tuổi; hàng đợi phân sắp `low_priority` trước nhất nên chỉ được phân khi Sale
   còn hạn mức sau khi đã nhận hết khách thường. Chưa eKYC = chưa biết tuổi → ưu tiên bình thường.
2. **Ngưỡng cuộc gọi hợp lệ**: giữ **20 giây** (mặc định `validCallMinAnswerSec`).
3. **Backfill**: **30 ngày** — `backfillCustomerCarePool.ts --app=tikluy --days=30` (chạy `--dry-run` trước).
