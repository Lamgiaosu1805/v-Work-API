# Module `customer-call` — Kế hoạch triển khai (DDD/Hexagonal + Omicall Web SDK + Webhook CDR)

Nguồn: SRS `CRM.04` (nhóm chức năng Omicall) v1.0, 20-08-2026 — 2 use case `CRM.04.1` (Danh sách khách
hàng cần gọi) + `CRM.04.2` (Lịch sử cuộc gọi) + tài liệu API Omicall (`Tài liệu API.xlsx`) + khảo sát
trực tiếp code FE `website-crm/src` (SDK Omicall đã tích hợp sẵn — mục 1.7) + payload webhook CDR thật
do bạn cung cấp (mục 1.8) + webhook debug cũ (`54acdab feat: test omicall`, nhánh `develop`, không có
trên nhánh này). Module mới, viết theo pattern DDD/Hexagonal đã áp dụng cho `src/modules/request`/
`src/modules/permission` — xem `CLAUDE.md` mục "DDD + Hexagonal Architecture".

**Quyết định kiến trúc chốt sau thảo luận (bản mới nhất — thay thế các quyết định cũ mâu thuẫn):**
- **FE gọi thẳng qua OMICall Web SDK (WebRTC)**, backend hoàn toàn không tham gia vào hành động
  "bấm gọi" — không có endpoint "Gọi ngay" nào cả (xem mục 1.7, 1.9).
- **Omicall tự đẩy webhook CDR về sau mỗi cuộc gọi** (có thể bắn nhiều lần cho cùng 1 `transaction_id`
  — phải upsert, không insert). Quyết định **lưu lại** toàn bộ CDR vào `CallLogModel` — đảo ngược
  quyết định cũ "không lưu cục bộ, luôn query live" (xem mục 1.8, mục 4).
- `CustomerCallStatsModel.call_count`/`last_contacted_at` giờ **cập nhật từ webhook** (khi cuộc gọi
  thật sự xảy ra, do Omicall xác nhận), không phải từ 1 API "xác nhận bấm gọi" như thiết kế ban đầu.
- Dùng đúng hệ thống ABAC (`src/modules/permission`) đã xây cho toàn bộ CRM, không tạo cơ chế phân
  quyền/hierarchy riêng cho module này.
- "Trưởng nhóm sale" = tái dùng khái niệm "cùng phòng ban" qua `subject.departmentColleagueUserIds`
  (đã thêm ở Phase 1), **không** dùng `Department.manager` + đệ quy cây phòng ban.
- Vì `CallLogModel` giờ là Mongo collection thật do module sở hữu, "Lịch sử cuộc gọi" dùng lại đúng cơ
  chế ABAC chuẩn (`toMongoQuery`) — **bỏ** thiết kế "resolver `agentIds` riêng" đã viết ở bản trước
  (xem mục 1.10, đã lỗi thời).

---

## 0. Câu hỏi đã chốt / còn mở

- [x] **FE gọi thẳng SDK, không qua backend.** `website-crm` đã nhúng OMICall Web SDK
      (`https://cdn.omicrm.com/sdk/web/3.0.41/core.min.js`), gọi bằng WebRTC
      (`window.OMICallSDK.makeCall(...)`). Backend không có endpoint "Gọi ngay" — xem mục 1.9.
- [x] **Lưu CallLog cục bộ, upsert theo `transaction_id` từ webhook** — không còn "chỉ query live API
      search" như quyết định ban đầu. Lý do đảo chiều: Omicall **chủ động đẩy** dữ liệu về (không phải
      mình chủ động kéo/đồng bộ) — không lưu lại thì phí dữ liệu đã có sẵn, và màn "Lịch sử cuộc gọi"
      filter/phân trang nhanh hơn nhiều so với gọi API ngoài mỗi lần render.
- [x] **Không cần job đồng bộ định kỳ** — dữ liệu vào hệ thống hoàn toàn thụ động qua webhook, không
      có gì để "quét bù" theo lịch (khác với lo ngại ban đầu khi tưởng phải tự đi lấy dữ liệu).
- [x] **"Tình trạng (Sale)" gắn theo từng cặp (sale, khách hàng)** — không đổi so với bản trước.
- [x] **Thêm field `email` vào `UserInfoModel`** (legacy, `default: null`, optional) — cần để tra cứu
      API Omicall `extensions/detail?type=user_email` lúc đồng bộ `SaleOmicallProfileModel` (mục 5).
      Hệ thống trước đây KHÔNG lưu email nhân viên ở đâu cả (`AccountModel.username` chỉ là login
      handle, không phải email — dữ liệu thật kiểu `datnq`/`hungnm`). **Cần HR/admin điền tay email
      cho từng nhân viên** trước khi tính năng "Kích hoạt SDK" hoạt động được cho người đó — không tự
      động hoá được bước này.
- [x] **Cần tầng "trưởng nhóm sale" thật** — không đổi so với bản trước, `CUSTOMER_OWN_DEPARTMENT` +
      `subject.departmentColleagueUserIds` đã seed xong ở Phase 1.
- [x] **Webhook debug cũ (`POST /omicall/call-hooks`, nhánh `develop`) sẽ bị thay thế**, không port
      logic cũ (chỉ log Redis) — viết route thật trong `customer-call/interface/`, path mới (vd
      `POST /customer-call/webhooks/omicall`). Vì route cũ chưa từng có trên nhánh đang làm việc, không
      cần xóa gì — chỉ là ghi chú để không nhầm "đã có webhook" khi thực ra chưa.
- [x] ~~SIP dùng chung là giới hạn nền tảng Omicall~~ — **ĐÍNH CHÍNH sau khi đọc lại `Tài liệu
      API.xlsx` (mục 5, nhóm "Nhân viên"/"Tổng đài"):** Omicall **CÓ** hỗ trợ SIP riêng theo từng nhân
      viên — API `GET /api/call_center/extensions/detail?type=user_email&keyword=<email>` trả đủ
      `sip_user`/`sip_password`/`sip_realm` theo từng người. SIP dùng chung hiện tại chỉ là shortcut
      code test của FE (`useOmiCall.js`), không phải giới hạn Omicall.
- [ ] **Vẫn CHẶN cho tới khi làm 2 việc (chưa làm, API tồn tại không tự động giải quyết):**
      (a) viết script/service đồng bộ `SaleOmicallProfileModel` từ API `extensions/detail` (mục 5),
      (b) sửa `useOmiCall.js` gọi `GET /customer-call/sip-credentials` (đã build, mục 1.9) thay vì
      hardcode `sipUser: "100"`. Trước khi 2 việc này xong, `CallLogModel.sale_id` vẫn `null`/sai cho
      mọi cuộc gọi — chặn thật cho phân quyền dữ liệu cuộc gọi theo từng sale.
- [ ] **Mockup ảnh gốc chưa có** — chưa đổi.
- [ ] **Nội dung FR_02, FR_03 của use case 2 trống trong SRS gốc** — chưa đổi, cần BA bổ sung.
- [ ] 3 lỗi copy-paste trong SRS gốc cần BA xác nhận — chưa đổi (xem bản trước, không lặp lại ở đây).
- [ ] **Cơ chế xác thực webhook Omicall gọi vào mình** — Omicall gọi `POST` tới URL do mình khai báo,
      nhưng chưa rõ có ký (HMAC signature header) hay whitelist IP không. Tạm thời route nhận mọi
      request (giống code debug cũ), ghi log — cần xác nhận với Omicall trước khi lên production, nếu
      không endpoint này bị giả mạo được (ai cũng POST được payload giả).

---

## 1. Thiết kế Database

### Nguyên tắc (đã đổi): lưu lại toàn bộ CDR Omicall chủ động đẩy về

Khác bản trước ("chỉ lưu cái Omicall không thể cho mình biết, còn lại query live") — giờ Omicall tự
đẩy **toàn bộ chi tiết cuộc gọi** (payload CDR, xem mục 1.8) qua webhook ngay sau khi cuộc gọi kết
thúc, có thể lặp lại nhiều lần cho cùng `transaction_id` (do cuộc gọi đi qua nhiều "leg"/kịch bản).
→ Lưu lại **toàn bộ** vào `CallLogModel`, upsert theo `transaction_id` (lấy bản mới nhất). Màn "Lịch
sử cuộc gọi" đọc thẳng từ DB mình, không gọi lại API `search` của Omicall nữa (API đó vẫn giữ trong
`OmicallClient` cho các nhu cầu khác — vd đối soát dữ liệu cũ hơn ngày webhook được bật, hoặc
debug/backfill thủ công — không phải đường đi chính).

### 1.1. `CustomerCallStatsModel` — bộ đếm cuộc gọi (Lần gọi, Liên hệ cuối)

```ts
{
  customer_id: ObjectId,      // ref "customer", unique — 1 bản ghi / khách hàng
  call_count: Number,         // default 0 — tăng khi webhook xác nhận 1 transaction_id MỚI (chưa từng thấy)
  last_contacted_at: Date | null,  // set = time_start_call của lần webhook mới nhất
  ...BaseSchema.obj
}
```
**Đổi so với bản trước:** không còn tăng ngay lúc "bấm gọi" (không còn endpoint đó nữa) — tăng khi
webhook xác nhận cuộc gọi **thật sự đã diễn ra** (có `transaction_id`), bất kể khách có trả lời hay
không (CDR luôn sinh ra dù cuộc gọi không được trả lời — `answer_sec` có thể = 0). Cách này thực ra
đáng tin hơn thiết kế cũ (nút bấm không đảm bảo cuộc gọi thực sự được khởi tạo qua SDK).

**Dedupe theo `transaction_id`:** phải kiểm tra trong `CallLogModel` xem `transaction_id` này đã tồn
tại chưa TRƯỚC KHI tăng `call_count` — nếu đã tồn tại (webhook bắn lại lần 2/3 cho cùng cuộc gọi) thì
chỉ update `CallLogModel`, không tăng `call_count` thêm lần nữa.

### 1.2. `CallLogModel` (MỚI) — chi tiết cuộc gọi, nguồn = webhook CDR

```ts
{
  transaction_id: String,        // unique — khóa upsert chính, ID cuộc gọi (duy nhất per Omicall)
  call_uuid: String,
  direction: "outbound" | "inbound" | "local",
  phone_number: String,          // SĐT khách hàng
  hotline: String,
  from_number: String,
  to_number: String,
  sip_user: String,              // extension nhân viên xử lý cuộc gọi (theo payload Omicall)
  sale_id: ObjectId | null,      // ref "user_info" — resolve từ sip_user qua SaleOmicallProfileModel.omicall_extension, null nếu không map được (xem mục 0 — vấn đề SIP dùng chung)
  customer_id: ObjectId | null,  // ref "customer" — resolve từ phone_number, null nếu không tìm thấy khách hàng khớp
  answer_sec: Number,            // >0 = có trả lời, =0 = không trả lời
  bill_sec: Number,
  duration: Number,
  call_out_price: Number,
  time_start_call: Date,         // payload là Unix giây — nhân 1000 khi map sang Date
  time_ringing_start: Date | null,
  time_answer_start: Date | null,
  time_end_call: Date | null,
  hangup_cause: String,
  recording_file_url: String,
  record_seconds: Number,
  note: String,                  // đồng bộ 2 chiều với Omicall qua updateCallTransaction (FR_07)
  tag: [String],
  raw_payload: Schema.Types.Mixed,  // giữ nguyên JSON webhook gốc — phòng khi cần field chưa map tới
  ...BaseSchema.obj
}
```
`raw_payload` lưu để không phải sửa schema mỗi khi cần thêm 1 field Omicall đã có sẵn trong payload
nhưng lúc đầu chưa thấy cần — tránh phải backfill/migrate lại lịch sử cũ.

**Index:** unique trên `transaction_id` (partial `isDeleted:false`, đúng convention). Thêm index phụ
`{ sale_id: 1, time_start_call: -1 }` và `{ customer_id: 1, time_start_call: -1 }` phục vụ filter màn
lịch sử.

### 1.3. `CustomerSaleRelationshipModel` — Tình trạng (Sale) theo từng cặp

Không đổi so với bản trước — xem file `src/models/CustomerSaleRelationshipModel.ts` (đã viết ở
Phase 1).

### 1.4. `SaleOmicallProfileModel` — mapping nhân viên ↔ Omicall

Không đổi field so với bản trước (`src/models/SaleOmicallProfileModel.ts`, đã viết ở Phase 1) — nhưng
**vai trò quan trọng hơn nhiều** so với đánh giá ban đầu: đây là mắt xích DUY NHẤT giúp quy `sip_user`
trong webhook CDR về đúng `sale_id` nội bộ. Cho tới khi mục này được điền đúng cho từng nhân viên
(và mỗi nhân viên login SDK bằng SIP thật của mình, không dùng chung tài khoản test), `CallLog.sale_id`
sẽ luôn `null` hoặc sai — xem cảnh báo ở mục 0.

**Cập nhật (sau khi thiết kế cơ chế đồng bộ, xem mục 5 phần "Kết luận"):** `omicall_agent_id` đổi
thành **optional/nullable** — API nguồn dữ liệu chính (`extensions/detail`) không trả field này, và
thiết kế hiện tại (mục 1.10, dùng `toMongoQuery` chuẩn cho `CallLog`) không còn đọc field này ở đâu
cả — giữ lại phòng trường hợp tương lai cần (vd gọi thêm `agent/get-by-email` để bù), không bắt buộc
phải có ngay.

### 1.5. Data Scope Policy — `Customer` (không đổi) + `CallLog` (MỚI)

`CUSTOMER_OWN_DEPARTMENT` (entity `Customer`, dùng cho màn "Danh sách khách hàng cần gọi") đã seed ở
Phase 1, không đổi.

**Thêm entity mới `CallLog`** (khác với thiết kế cũ "tái dùng entity Customer cho cả 2 màn" — không
còn hợp lý nữa vì giờ 2 màn query 2 collection khác nhau, `toMongoQuery` cần đúng entity/collection):

```ts
{ code: "CALL_LOG_ALL_COMPANY", entity: "CallLog", label: "Toàn công ty", conditionTree: null },
{
  code: "CALL_LOG_SELF_ASSIGNED",
  entity: "CallLog",
  label: "Chỉ cuộc gọi của chính mình",
  conditionTree: selfCondition("resource.sale_id", "subject.userId")
},
{
  code: "CALL_LOG_OWN_DEPARTMENT",
  entity: "CallLog",
  label: "Cùng phòng ban",
  conditionTree: ownDepartmentColleaguesCondition("resource.sale_id")
}
```

**Thêm entity mới `SaleOmicallProfile`** — dùng riêng cho `customer_call.initiate` (mục 1.6). Không có
tier thật (giống pattern các entity "generic" khác trong `GENERIC_ALL_COMPANY_ENTITIES`) vì bản chất
chỉ là gate có/không, luôn chỉ đọc đúng hồ sơ của chính mình:

```ts
{
  code: "SALE_OMICALL_PROFILE_ALL_COMPANY",
  entity: "SaleOmicallProfile",
  label: "Toàn công ty",
  conditionTree: null
}
```

### 1.6. Permission Catalog — tách `customer_call.view` thành 2 quyền, `customer_call.initiate` đổi ý nghĩa

**Đổi so với Phase 1 đã seed:**

| code | entity | actionKind | Data Scope | Ghi chú |
|---|---|---|---|---|
| `customer_call.view` | `Customer` | READ | SELF_ASSIGNED / OWN_DEPARTMENT / ALL_COMPANY | Chỉ còn dùng cho "Danh sách khách hàng cần gọi" |
| `call_log.view` (MỚI) | `CallLog` | READ | CALL_LOG_SELF_ASSIGNED / CALL_LOG_OWN_DEPARTMENT / CALL_LOG_ALL_COMPANY | "Lịch sử cuộc gọi" |
| `customer_call.initiate` (ĐỔI Ý NGHĨA) | `SaleOmicallProfile` (đổi từ `Customer`) | STRUCTURAL | SALE_OMICALL_PROFILE_ALL_COMPANY (đổi từ 3 tier CUSTOMER_*) | **Không còn** gate "được gọi khách hàng cụ thể" — đổi thành gate "được lấy SIP credentials để kích hoạt SDK" (mục 1.9), check 1 lần lúc app khởi động/login, không phải mỗi lần bấm gọi |
| `customer_call.update_relationship_status` | `Customer` | WRITE | SELF_ASSIGNED / OWN_DEPARTMENT / ALL_COMPANY | Không đổi |

**Việc cần làm lại ở Phase 1 (đã seed sai theo thiết kế cũ, cần sửa):**
- `scripts/seedPermissionCatalog.ts`: thêm `call_log.view` (entity `CallLog`); sửa `customer_call.initiate`
  — đổi `entity` từ `Customer` sang `SaleOmicallProfile`, đổi `validDataScopePolicies` từ 3 tier
  `CUSTOMER_CALL_SCOPES` sang `["SALE_OMICALL_PROFILE_ALL_COMPANY"]`.
- `scripts/seedPermissionEntityAttributeCatalog.ts`: thêm entry entity `CallLog` (subject:
  `subject.userId`, `subject.departmentColleagueUserIds`; resource: `resource.sale_id`); thêm entry
  entity `SaleOmicallProfile` (không cần subject/resource attribute, chỉ cần tồn tại entry rỗng như
  các entity generic khác, xem `Department`/`Position`... trong
  `seedPermissionEntityAttributeCatalog.ts`).
- `scripts/seedPermissionDataScopePolicy.ts`: thêm 3 policy `CALL_LOG_*` + 1 policy
  `SALE_OMICALL_PROFILE_ALL_COMPANY` (mục 1.5).
- `scripts/seedPermissionCrmRoles.ts`: `CRM_SALE`/`CRM_SALE_TEAM_LEAD` thêm grant `call_log.view`
  (scope tương ứng self/own_department); sửa grant `customer_call.initiate` đã có sẵn — đổi
  `dataScopePolicyCode` từ `CUSTOMER_SELF_ASSIGNED`/`CUSTOMER_OWN_DEPARTMENT` sang
  `SALE_OMICALL_PROFILE_ALL_COMPANY` cho cả 2 role (vì giờ chỉ còn 1 tier, không phân biệt self/dept
  nữa — ai có quyền `initiate` đều chỉ lấy được đúng hồ sơ SIP của chính mình, không có gì để phân
  theo phạm vi rộng/hẹp).

### 1.7. FE `website-crm` đã tích hợp sẵn OMICall Web SDK (không đổi so với bản trước)

Xem lại: `index.html` nạp SDK, `useOmiCall.js` register (SIP dùng chung, hardcode — vấn đề mở ở mục
0), `utils/omiCall.js` (`makeOmiCall`/`openOmiDial`), `CSKHScreen.jsx` (demo tạm).

### 1.8. Webhook CDR thật — payload đã có (thay thế "chưa có payload" ở bản trước)

Bạn đã cung cấp payload CDR thật (webhook "khi cuộc gọi kết thúc") + payload event real-time (webhook
"khi cuộc gọi đang diễn ra": `create`/`early`/`ringing`/`answered`/`hangup`). Các field quan trọng đã
map vào `CallLogModel` (mục 1.2). Lưu ý xử lý:

- **Idempotency:** upsert theo `transaction_id`, KHÔNG insert — Omicall có thể bắn lại nhiều lần.
- **`time_*` là Unix giây, không phải mili giây** — theo chú thích gốc "x 1000 = Unix time
  milisecond" — nhân 1000 trước khi tạo `Date`.
- **`create_by.name === "create_default_by_tenant"`** = cuộc gọi không xác định được nhân viên (theo
  chú thích Omicall) — trường hợp này `CallLog.sale_id` chắc chắn `null`, không phải lỗi map.
- **Webhook event real-time** (`ringing`/`answered`/`hangup`...) — nhẹ hơn CDR, dùng cho mục đích khác
  (đẩy UI real-time, vd hiện popup "đang gọi" → "đã kết thúc") — KHÔNG dùng để ghi `CallLogModel`
  (CallLog chỉ ghi từ webhook CDR đầy đủ). Việc có xử lý webhook event real-time hay không để Phase
  riêng, không block Phase 1-4 hiện tại (xem Phase 4).

### 1.9. Luồng "Gọi ngay" (CRM.04.1) — bản cuối

**Kích hoạt SDK (1 lần, lúc app khởi động/login — MỚI, thay cho endpoint "Gọi ngay" đã bỏ):**
1. FE gọi `GET /customer-call/sip-credentials` — check `customer_call.initiate` (entity
   `SaleOmicallProfile`, mục 1.6). Không đủ quyền → 403, FE không kích hoạt SDK, ẩn toàn bộ tính năng
   gọi.
2. Đủ quyền → backend query `SaleOmicallProfileRepository.findBySaleId(employeeId)`, trả
   `{ sipRealm, sipUser: omicallExtension, sipPassword }`.
3. FE dùng bộ creds này gọi `OMICallSDK.register({ sipRealm, sipUser, sipPassword })` — thay cho
   hardcode `sipUser: "100"` hiện tại.

**Từng lần gọi 1 khách hàng cụ thể (không đổi so với bản trước):**
1. FE tự gọi `makeOmiCall(customer.phone, customer.name)` (SDK) khi bấm nút — **không gọi backend
   trước/sau cho từng lần gọi cụ thể.**
2. Nút "Gọi ngay" ẩn/hiện ở FE dựa theo quyền đã trả sẵn từ API lấy danh sách khách hàng (đã gắn
   `customer_call.view`) — chấp nhận rủi ro bypass qua devtool ở mức UI (không có gate riêng cho hành
   động gọi), vì bản chất SDK cũng chỉ chạy được khi đã đăng nhập app + có phiên hợp lệ.
3. `call_count`/`last_contacted_at` cập nhật hoàn toàn thụ động qua webhook (mục 1.1, 1.8) — không
   còn phụ thuộc FE có gọi báo backend hay không.
4. `OmicallClient.clickToCall()` (REST) tiếp tục KHÔNG cần thiết cho luồng chính — giữ nguyên đánh giá
   ở bản trước.

### 1.10. (ĐÃ LỖI THỜI — xem mục 1.5/1.6) Thiết kế cũ "resolver `agentIds` riêng, không dùng `toMongoQuery`"

Bản kế hoạch trước có 1 mục thiết kế `resolveCallHistoryAgentScope()` để tự dịch Data Scope sang tham
số `filter.agentIds` gọi API Omicall — vì lúc đó "Lịch sử cuộc gọi" chưa có collection Mongo riêng.
Giờ có `CallLogModel`, phần này **không còn cần thiết** — dùng lại `toMongoQuery(ability,
"call_log.view", "CallLog")` y hệt mọi entity khác trong hệ thống. Giữ mục này lại (đánh dấu lỗi thời)
để không mất dấu vết quyết định — không triển khai theo hướng cũ nữa.

---

## 2. Cấu trúc module (DDD/Hexagonal) — bản cập nhật

```
src/modules/customer-call/
  domain/
    customer-call-stats.entity.ts        # recordCallAttempt() -> tăng call_count, set last_contacted_at (nay gọi từ webhook handler, không phải API riêng)
    call-log.entity.ts                   # MỚI — createOrUpdateFromWebhook(), gắn sale_id/customer_id đã resolve
    customer-sale-relationship.entity.ts # updateStatus(newStatus) — không đổi
    sale-omicall-profile.entity.ts       # không đổi
    customer-call.errors.ts
  infrastructure/
    customer-call-stats.repository.ts / .mapper.ts
    call-log.repository.ts / .mapper.ts  # MỚI — findByTransactionId(), findManyPaginated(filter theo ability.toMongoQuery)
    customer-sale-relationship.repository.ts / .mapper.ts
    sale-omicall-profile.repository.ts / .mapper.ts
  application/
    handle-omicall-webhook.service.ts    # MỚI — thay hẳn initiate-call.service.ts (đã bỏ): parse payload, resolve sale_id/customer_id, upsert CallLog, update CustomerCallStats (dedupe theo transaction_id)
    update-sale-relationship-status.service.ts
    list-customers-to-call.service.ts    # CQRS-lite read: Customer + CustomerCallStats + CustomerSaleRelationship
    list-call-history.service.ts         # CQRS-lite read: toMongoQuery(ability, "call_log.view", "CallLog") + CallLogRepository — KHÔNG còn gọi OmicallClient nữa (đọc DB mình)
  interface/
    customer-call.http.controller.ts     # list-customers-to-call, update-relationship-status
    customer-call-webhook.http.controller.ts  # MỚI — nhận POST webhook Omicall (không qua authenticate/requirePermission — xác thực riêng theo cơ chế Omicall, xem mục 0)
    customer-call.routes.ts
  index.ts
```

`src/utils/omicallClient.ts` (đã viết Phase 2, KHÔNG nằm trong module — dùng chung nhiều nơi nếu cần)
vẫn giữ nguyên, dùng cho `list-call-history.service.ts` chỉ trong trường hợp cần backfill/đối soát dữ
liệu cũ hơn thời điểm bật webhook — không phải đường đi chính nữa.

**Bỏ hẳn:** `initiate-call.service.ts` (đã viết nháp ở phiên trước rồi dừng lại đúng lúc — chưa commit
vào code, không cần dọn dẹp gì) và `resolve-call-history-agent-scope.ts` (thiết kế cũ, mục 1.10).

---

## 3. Task Breakdown — bản cập nhật

### Phase 0 — Chờ BA/Omicall xác nhận (không block code)
- [ ] Nội dung thật FR_02/FR_03.
- [ ] 3 lỗi copy-paste trong SRS.
- [ ] File mockup ảnh gốc.
- [ ] Cơ chế xác thực webhook (HMAC/IP whitelist?) — mục 0.
- [ ] SIP riêng theo từng nhân viên — mục 0 (chặn tính năng phân quyền theo sale, KHÔNG chặn việc
      build code).

### Phase 1 — Data model (ĐÃ LÀM XONG PHẦN CŨ — cần bổ sung/sửa theo thiết kế mới)
- [x] 3 model gốc (`CustomerCallStatsModel`, `CustomerSaleRelationshipModel`, `SaleOmicallProfileModel`)
      + domain entity + repository/mapper — đã xong, không đổi.
- [x] `CUSTOMER_OWN_DEPARTMENT` + `subject.departmentColleagueUserIds` — đã xong, không đổi.
- [ ] **MỚI:** `CallLogModel` + `call-log.entity.ts` + repository/mapper (mục 1.2).
- [ ] **SỬA:** `seedPermissionCatalog.ts` — thêm `call_log.view`; sửa `customer_call.initiate` đổi
      entity `Customer` → `SaleOmicallProfile` (mục 1.6).
- [ ] **MỚI:** `seedPermissionEntityAttributeCatalog.ts` — thêm entity `CallLog` + `SaleOmicallProfile`.
- [ ] **MỚI:** `seedPermissionDataScopePolicy.ts` — thêm 3 policy `CALL_LOG_*` + 1 policy
      `SALE_OMICALL_PROFILE_ALL_COMPANY`.
- [ ] **SỬA:** `seedPermissionCrmRoles.ts` — thêm grant `call_log.view` ở `CRM_SALE`/
      `CRM_SALE_TEAM_LEAD`; sửa `dataScopePolicyCode` của grant `customer_call.initiate` (đã có sẵn ở
      2 role) sang `SALE_OMICALL_PROFILE_ALL_COMPANY`.

### Phase 2 — `OmicallClient` adapter (ĐÃ XONG, không đổi)
- [x] `searchCallTransactions`/`getCallTransactionById`/`updateCallTransaction`/`getAgentByEmail` —
      `src/utils/omicallClient.ts`. Vai trò giảm xuống "dùng khi cần" (backfill/note sync), không còn
      là nguồn chính cho màn lịch sử.

### Phase 3 — Application + Interface
- [ ] `handle-omicall-webhook.service.ts` — parse payload CDR, resolve `sale_id` (qua
      `SaleOmicallProfileModel.omicall_extension = payload.sip_user`), resolve `customer_id` (qua
      `CustomerModel.phone_number = payload.phone_number`, cần chuẩn hoá SĐT), upsert `CallLog` theo
      `transaction_id`, nếu là `transaction_id` mới thì gọi `CustomerCallStatsEntity.recordCallAttempt()`.
- [ ] `POST /customer-call/webhooks/omicall` — route riêng, KHÔNG qua `authenticate`/`requirePermission`
      (Omicall gọi vào, không phải người dùng app) — xác thực theo cơ chế riêng khi có (mục 0).
- [ ] `GET /customer-call/sip-credentials` — check `customer_call.initiate` (entity
      `SaleOmicallProfile`, mục 1.9), trả `{ sipRealm, sipUser, sipPassword }` từ
      `SaleOmicallProfileRepository.findBySaleId(employeeId)` — 404 nếu chưa có hồ sơ.
- [ ] `PATCH /customer-call/customers/:id/relationship-status` — check
      `customer_call.update_relationship_status` (không đổi).
- [ ] `GET /customer-call/customers` — check `customer_call.view` (không đổi).
- [ ] `GET /customer-call/history` — check `call_log.view`, dùng `toMongoQuery()` chuẩn + query
      `CallLogModel` local (KHÔNG gọi `OmicallClient` nữa).

### Phase 4 — Webhook event real-time (ĐÃ XONG)

- [x] `POST /customer-call/webhooks/omicall-events` — route riêng (khác `/webhooks/omicall` — webhook
      CDR), không qua `authenticate`. Nhận webhook "cuộc gọi đang diễn ra" của Omicall
      (`create`/`early`/`ringing`/`answered`/`hangup`).
- [x] `handle-omicall-call-event.service.ts` — tra `extension` → `SaleOmicallProfileModel` → `sale_id`
      → `getIO().to(\`user:${saleId}\`).emit("customer_call:state", {...})`. Tái dùng đúng hạ tầng
      `socket.io` + room `user:<userInfoId>` đã có sẵn cho module `chat`/`notification` (xem
      `src/sockets/chatSocket.js`, `src/services/notificationService.js`) — không tạo cơ chế real-time
      riêng. **Không ghi DB** — thuần tín hiệu UI, không phải nguồn dữ liệu (khác `CallLog`).
- [x] Toàn bộ hàm bọc `try/catch`, lỗi chỉ `logger.error()` — **luôn trả `200`** cho Omicall dù xử lý
      nội bộ thất bại (đã cân nhắc: trả lỗi thật/5xx không có lợi hơn vì chưa xác nhận Omicall có tự
      retry hay không; mất 1 tín hiệu UI không nghiêm trọng — state kế tiếp thường tới sau vài giây).
      Không dựng bảng DB riêng để log lỗi này — mức độ nghiêm trọng không tương xứng chi phí vận hành
      thêm 1 bảng (ai xem, dọn dẹp thế nào...); `logger.error()` là đủ.

**Contract socket cho FE (chưa implement phía FE — để Phase 5):**
```
Event: "customer_call:state"
Room: "user:<userInfoId của sale đang xử lý cuộc gọi>" (tự động join khi client connect, không cần code thêm)
Payload: { callUuid: string, phoneNumber: string, state: "create"|"early"|"ringing"|"answered"|"hangup", direction: "outbound"|"inbound" }
```

### Phase 5 — Frontend (website-crm) — không đổi so với bản trước
- [ ] Màn "Danh sách khách hàng cần gọi" — nút "Gọi ngay" giờ CHỈ gọi `makeOmiCall()`, không gọi
      backend trước (khác bản trước).
- [ ] Màn "Lịch sử cuộc gọi".
- [ ] Chờ mockup ảnh thật.

---

## 4. Việc KHÔNG làm (đã cân nhắc và loại bỏ) — bản cập nhật

- ~~Job `node-cron` quét bù định kỳ~~ — bỏ, dữ liệu vào hoàn toàn thụ động qua webhook.
- ~~Refactor `getManagedUserIds()` ra `shared-kernel`~~ — bỏ, dùng "cùng phòng ban" đơn giản hơn.
- ~~Model hierarchy "ai quản ai" riêng cho CRM~~ — bỏ, dùng đúng ABAC hiện có.
- ~~Endpoint backend check quyền theo TỪNG lần gọi (`POST .../call-attempts`)~~ — bỏ, FE gọi thẳng SDK
  cho từng cuộc gọi cụ thể. **Không bỏ hẳn mọi endpoint** — thay bằng `GET
  /customer-call/sip-credentials`, check quyền 1 lần lúc kích hoạt SDK, không phải mỗi lần gọi (mục
  1.9).
- ~~Resolver `agentIds` riêng cho Data Scope "Lịch sử cuộc gọi"~~ — bỏ, dùng `toMongoQuery` chuẩn vì
  giờ có `CallLogModel` (mục 1.10).
- ~~"Không lưu `CallLogModel`, luôn query live"~~ — **đảo ngược quyết định này** — nay CÓ lưu, vì
  Omicall chủ động đẩy dữ liệu về qua webhook (mục 1.8).

---

## 5. Phụ lục — Danh mục đầy đủ API Omicall (đọc từ `Tài liệu API.xlsx`, 48 endpoint)

Ghi lại toàn bộ để tra cứu nhanh khi cần tích hợp thêm sau này (không phải endpoint nào cũng dùng
trong module này). Cột **Dùng ở đây** đánh dấu endpoint đã/sẽ dùng trong `customer-call`, kèm mục
tham chiếu.

### Nhóm "Nhân viên" — quan trọng nhất cho việc đồng bộ `SaleOmicallProfileModel`

| Feature | Endpoint | Mô tả | Dùng ở đây |
|---|---|---|---|
| Danh sách nhân viên | `GET /api/v3/agent/search?page=&size=` | Tìm/phân trang agent, lọc theo `filter.emails[]`/`filter.phones[]`/`filter.extensions[]`. Trả `_id` (agentId), `identify_info` (email), `attribute_structure` (full_name, phone_number...). | Chưa dùng — ứng viên cho script sync hàng loạt (mục dưới). |
| Mời nhân viên | `POST /api/agent/invite` | Tạo mới agent + tự khởi tạo `pbx_account` (SIP) trong 1 lần gọi. | Chưa dùng. |
| Xóa nhân viên | `DELETE /api/agent/delete?identify_info=` | Xóa theo email. | Chưa dùng. |
| Mời kèm gói dịch vụ | `POST /api/agent/invite_with_package_v2` | Như trên + gán `service_package_id`. | Chưa dùng. |
| Cập nhật phân quyền | `POST /api/agent/role/update` | Đổi `role_id` của agent. | Chưa dùng. |
| Cập nhật gói dịch vụ | `POST /api/agent/service_package/update` | Đổi/gỡ `service_package_id`. | Chưa dùng. |
| **Lấy thông tin nhân viên qua Email** | `GET /api/v2/agent/get-by-email` | Trả `id`/`contact_id`/`email`/`phone`/`full_name` + **`pbx_account.sip_user`/`pbx_account.sip_password`**. | **Ứng viên chính** để sync `SaleOmicallProfileModel` (thiếu `sip_realm` — xem endpoint bên dưới bù). |
| Chuyển chủ sở hữu tài khoản | `POST /api/v3/agent/transfer` | Chuyển quyền sở hữu agent từ email này sang email khác. | Chưa dùng. |

### Nhóm "Tổng đài" — cấu hình SIP/hotline/nhóm nội bộ

| Feature | Endpoint | Mô tả | Dùng ở đây |
|---|---|---|---|
| Danh sách số nội bộ | `GET /api/call_center/internal_phone/list?keyword=&page=&size=` | List extension, có `sip_user`/`password`/`agent_id`/`email`/`full_name`/`domain`/`outbound_proxy`. | Ứng viên phụ cho sync hàng loạt (thay thế `agent/search` nếu cần nhiều field SIP hơn). |
| Cập nhật trạng thái máy lẻ | `POST /api/call_center/internal_phone/status?enabled=&sip_user=` | Bật/tắt 1 extension. | Chưa dùng. |
| Danh sách hotline gọi ra được | `GET /api/call_center/hotline/list?extension=` | Hotline mà 1 extension được cấp quyền gọi ra. | Chưa dùng — có thể cần nếu sau này hiển thị "gọi từ hotline nào" ở FE. |
| Danh sách hotline | `GET /api/call_center/hotline/search` | Tìm/phân trang hotline. | Chưa dùng. |
| Thông tin 1 hotline | `GET /api/call_center/hotline/by-phone` | Chi tiết 1 hotline theo số. | Chưa dùng. |
| Cập nhật hotline | `POST /api/call_center/hotline/update` | Sửa cấu hình gọi vào/ra, kịch bản mặc định. | Chưa dùng. |
| **Thông tin số nội bộ (chi tiết)** | `GET /api/call_center/extensions/detail?type=user_email\|sip_user\|usr_uuid&keyword=` | Trả đủ **`pbx_account.sip_user`/`sip_password`/`sip_realm`/`sip_web_socket_server`/`sip_proxy`** — bộ credentials ĐẦY ĐỦ NHẤT để `OMICallSDK.register()`. | **Ứng viên chính**, đầy đủ hơn `agent/get-by-email` — có `sip_realm` mà API kia thiếu. |
| Cập nhật số nội bộ | `POST /api/call_center/internal_phone/update` | Đổi mật khẩu/thời gian chờ chuyển tiếp của 1 `sip_user`. | Chưa dùng — có thể cần nếu muốn tự đổi mật khẩu SIP định kỳ. |
| Làm mới số nội bộ | `POST /api/call_center/internal_phone/refresh?sip_user=` | Reset toàn bộ cấu hình 1 extension về mặc định. | Chưa dùng. |
| Danh sách/tạo/sửa/xóa nhóm nội bộ | `.../internal_group/list|add|update/:id|add-members|delete/:id` | Ring group — cấu hình đổ chuông nhiều nhân viên khi có cuộc gọi vào hàng đợi. | Chưa dùng — ngoài phạm vi SRS hiện tại (không có "hàng đợi nhóm" trong CRM.04). |
| Danh sách kịch bản gọi | `GET /api/call_center/call_script/list?page=&size=` | List kịch bản IVR/callbot. | Chưa dùng. |
| Danh sách file ghi âm/lời chào | `GET /api/call_center/greeting/list` | List file lời chào đã upload. | Chưa dùng. |
| Text-to-Speech | `POST /api/ai/text_to_speech` | Chuyển văn bản thành giọng nói. | Chưa dùng. |
| Click2call | `POST /api/click2call` | Đặt cuộc gọi qua REST (server-side). | Hạ ưu tiên — FE dùng Web SDK, không dùng REST này (mục 1.7/1.9). |

### Nhóm "Lịch sử cuộc gọi" — đã dùng trong `OmicallClient`

| Feature | Endpoint | Mô tả | Dùng ở đây |
|---|---|---|---|
| Danh sách lịch sử cuộc gọi | `POST /api/v3/call-transaction/search?page=&size=` | Filter theo thời gian/hướng/nhân viên/SĐT/tag/loại cuộc gọi. | Có trong `OmicallClient.searchCallTransactions()` (Phase 2) — vai trò giảm còn "backfill/đối soát", không phải nguồn chính (mục 1.8/1.10). |
| Chi tiết cuộc gọi | `GET /api/v2/callTransaction/getByTransactionId` | Chi tiết 1 cuộc gọi theo `transactionId`. | `OmicallClient.getCallTransactionById()` — tương tự, chỉ dùng khi cần. |
| Cập nhật thông tin cuộc gọi | `PATCH /api/call_transaction/change/:transaction_id` | Sửa `tag`/`note` cho 1 bản ghi. | `OmicallClient.updateCallTransaction()` — dùng cho FR_07 (ghi chú sau cuộc gọi). |
| Danh sách tiêu chí đánh giá | `GET /api/v3/call-transaction/evaluation-criteria/list` | List tiêu chí chấm điểm cuộc gọi. | Chưa dùng — SRS hiện tại không có yêu cầu chấm điểm cuộc gọi. |
| Đánh giá cuộc gọi theo tiêu chí | `POST /api/v3/call-transaction/add-evaluation` | Tạo 1 lượt đánh giá. | Chưa dùng, cùng lý do trên. |
| Báo cáo tổng quan cuộc gọi | `GET /api/v3/call-transaction/report` | Thống kê theo hướng gọi/trạng thái trả lời, breakdown theo ngày/khung giờ. Tối đa 12 tháng, KHÔNG filter theo agent. | Chưa dùng — có thể hữu ích cho dashboard CRM sau này (ngoài phạm vi CRM.04). |

### Nhóm "Gọi tự động" (Callbot) — ngoài phạm vi SRS hiện tại

| Feature | Endpoint | Mô tả |
|---|---|---|
| Gọi tự động hàng loạt | `POST /api/call_bot/execute_by_phone` | Khởi tạo callbot gọi hàng loạt theo kịch bản, hỗ trợ biến cá nhân hoá nội dung đọc. Response 200 không đảm bảo toàn bộ gọi thành công — phải check mảng `errors` (vd `number_dnc`). Chưa rõ giới hạn số lượng contact/lần gọi. |
| Danh sách kịch bản bot | `GET /api/call_bot/script/list` | Lấy `bot_script_id` + field_code các biến để dùng cho API trên. |

### Nhóm "Phiếu ghi" (Ticket) — không liên quan CRM.04, ghi lại để tham khảo module khác sau này

12 endpoint CRUD ticket đầy đủ (`search`/`getById`/`create`/`update`/`delete`/`update_status`/
`category/get_all`/`log/create`/`log/update`/`log/delete`/`statistics`/`evaluation/create`) +
1 endpoint chuyển nhân viên phụ trách hàng loạt (`agent/ticket/transfer`, chuyển toàn bộ ticket 6
tháng gần nhất). Đây là module "phiếu ghi CSKH" riêng của Omicall — không thuộc phạm vi CRM.04, không
note chi tiết ở đây, cần đọc lại `Tài liệu API.xlsx` trực tiếp nếu sau này có nhu cầu tích hợp.

### Kết luận rút ra cho việc sync `SaleOmicallProfileModel`

2 API `GET /api/v2/agent/get-by-email` và `GET /api/call_center/extensions/detail?type=user_email`
đều tra cứu theo **email nhân viên** và đều trả `sip_user`/`sip_password` — nhưng chỉ
`extensions/detail` có thêm `sip_realm` (bắt buộc phải có để FE gọi `OMICallSDK.register()`, xem mục
1.9). → **Dùng `extensions/detail` làm nguồn chính** khi viết script/service đồng bộ
`SaleOmicallProfileModel` sau này (chưa implement — để Phase riêng, xem mục 3).

---

## 6. Ghi chú review Phase 3 (sau khi code thật, verify bằng script/tài liệu chính thức)

Các điểm được đặt câu hỏi/soi kỹ trong lúc review code Phase 3 — ghi lại kết luận + bằng chứng để
không phải điều tra lại lần sau.

### 6.1. `normalizePhoneNumber` — coupling sai chỗ, đã sửa

Ban đầu định nghĩa trong `handle-omicall-webhook.service.ts` (1 service nghiệp vụ cụ thể) rồi bị 2
service khác (`reconcile-call-history.service.ts`, `list-customers-to-call.service.ts`) import lại —
rủi ro: sửa logic webhook sau này vô tình ảnh hưởng tới filter/reconcile không liên quan. **Đã sửa:**
tách ra `domain/normalize-phone-number.ts` — hàm thuần, không phụ thuộc gì, đúng ranh giới domain
layer. Chỉ đặt trong module `customer-call` (chưa đẩy ra `src/utils/`/`shared-kernel/`) vì hiện tại
chỉ module này cần dùng — chưa có bằng chứng module khác cần.

### 6.2. `$facet` (`list-customers-to-call.service.ts`) có "double cost" join khi tách nhánh `totalCount` không?

**Không.** Verify qua tài liệu MongoDB chính thức (không đoán): "Input documents are passed to the
`$facet` stage only once... Each sub-pipeline within `$facet` is passed the exact same set of input
documents." — mọi stage TRƯỚC `$facet` (`$match`, 2 lần `$lookup`+`$unwind`, `$addFields`,
`$match(relationshipStatus)`) chỉ chạy **đúng 1 lần**, kết quả mới được đưa vào cả 2 nhánh `data`/
`totalCount`. Phần chạy lặp lại chỉ là thao tác RẺ bên trong từng nhánh (`$skip`+`$limit`+`$project`
vs `$count`) trên cùng 1 tập document đã tính sẵn — không phải join lại từ đầu.

→ **Kết luận: giữ nguyên `$facet`, KHÔNG tách `totalCount` thành `aggregate()` riêng chạy song song**
— tách ra sẽ khiến mỗi lệnh `aggregate()` độc lập phải tự chạy lại toàn bộ phần join từ đầu, đắt hơn
thiết kế hiện tại chứ không rẻ hơn.

**Điểm cần lưu ý thật (khác câu hỏi ban đầu):** `$facet` buffer TOÀN BỘ tập document khớp `matchStage`
vào memory trước khi chia nhánh — giới hạn 100MB/stage nếu không bật `allowDiskUse`. Đây là lý do
thật khiến `matchStage` cần chọn lọc tốt khi data lớn (xem mục 6.3), không phải do join bị lặp.

Nguồn: [MongoDB `$facet` (aggregation reference)](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/)

### 6.3. Chi phí `$lookup` trong `list-customers-to-call.service.ts` tỉ lệ với gì?

Tỉ lệ với **số document khớp `matchStage`** (tức là khớp `scopeFilter` từ ABAC + filter `status`/
`phoneNumber`), KHÔNG tỉ lệ với số dòng hiển thị sau phân trang — vì cột "Tình trạng (Sale)" luôn
phải hiển thị cho mọi dòng kết quả (không chỉ khi có filter `relationshipStatus`), nên `$lookup` vốn
đã cần chạy cho toàn bộ `matchStage` result bất kể có filter đó hay không.

**Đòn bẩy thật để kiểm soát chi phí:** độ chọn lọc của `scopeFilter` (tier ABAC) — sale thường
(`SELF_ASSIGNED`) khớp rất ít document, quản lý toàn công ty (`ALL_COMPANY`) gần như quét hết bảng
`customer`.

**Đã hỏi & xác nhận:** quy mô `customer` thật hiện tại ~vài nghìn record trở xuống → **chưa cần tối
ưu ngay**. Test DB (`v_work_db`) hiện có 0 record trong collection `customer`, không dùng được để đo
thật — quyết định dựa trên ước tính bạn cung cấp trực tiếp.

**Khi data lớn hơn (chục/trăm nghìn record trở lên) — cân nhắc lại:** denormalize
`relationshipStatus`/`callCount`/`lastContactedAt` thẳng lên field trong `CustomerModel` (cập nhật
đồng thời lúc ghi — trong `handle-omicall-webhook.service.ts`/`update-sale-relationship-status.service.ts`
— thay vì `$lookup` lúc đọc), đổi tradeoff từ "đọc chậm dần theo data" sang "ghi phức tạp hơn 1 chút".
Chưa làm — chỉ ghi lại hướng đi khi cần.

### 6.4. `toMongoQuery()` — nếu `ability` không có rule khớp, có leak toàn bộ dữ liệu không?

**Không — verify bằng script thật** (`buildAbility([])` rồi gọi `toMongoQuery`, xem cả 3 case: không
rule nào / rule cho action-entity khác / có đúng rule ALL_COMPANY):

| Case | `ability.can()` | `toMongoQuery()` |
|---|---|---|
| Không có rule nào khớp | `false` | `{"$expr":{"$eq":[0,1]}}` |
| Có rule nhưng cho action/entity khác | `false` | `{"$expr":{"$eq":[0,1]}}` |
| Có đúng rule, `conditionTree: null` (ALL_COMPANY) | `true` | `{}` |

Không có rule khớp → CASL (`accessibleBy()` bên trong `toMongoQuery`) trả về filter **luôn luôn
`false`** (`0 = 1` không bao giờ đúng), khớp 0 document — KHÔNG phải object rỗng `{}` (sẽ khớp tất
cả). Mặc định của CASL là "không có rule = chặn", không phải "không có rule = cho qua" — an toàn.

Thêm 1 lớp bảo vệ độc lập (đã có sẵn): `requirePermission` middleware chặn ở route bằng
`ability.can(action, subject)` **trước khi** request chạm tới service — nếu `false` thì
`ForbiddenException` (403) ngay, `list-customers-to-call.service.ts`/`list-call-history.service.ts`
không bao giờ chạy tới trong trường hợp đó. Nhưng như bảng trên cho thấy, kể cả không có lớp chặn
route này, bản thân `toMongoQuery` cũng tự an toàn theo đúng thiết kế CASL.
