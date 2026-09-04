# Module `customer-call` — Đối chiếu SRS CRM.04 (Omicall) vs code đã build

Nguồn: `vWork - CRM website - Tài liệu SRS.pdf`, mã tài liệu **CRM.04**, phiên bản 1.0, xuất bản
20-08-2026 (file gốc: `~/Downloads/vWork - CRM website - Tài liệu SRS.pdf`). Tài liệu này được đọc
**sau khi** module `customer-call` (`src/modules/customer-call/`) đã build gần xong qua nhiều vòng
thảo luận trực tiếp với PM (không có SRS trong tay lúc đó) — nên có một số quyết định thiết kế
**lệch có chủ đích hoặc vô tình** so với SRS. Tài liệu này liệt kê toàn bộ gap tìm được, chưa sửa gì —
mục đích để PM/dev chốt hướng trước khi code tiếp, theo đúng tinh thần "ghi nhận deviation" đã áp
dụng ở `docs/PERMISSION-MODULE-PLAN.md`.

SRS gồm 3 use case: **CRM.04.1** Xem danh sách khách hàng cần gọi, **CRM.04.2** Xem lịch sử cuộc gọi,
**CRM.04.3** Tổng đài (quản lý đầu số Hotline).

---

## 0. Gap nghiêm trọng nhất — kiến trúc nguồn dữ liệu "Lịch sử cuộc gọi" — ✅ ĐÃ CHỐT (03-09-2026): giữ nguyên kiến trúc hiện tại (webhook + `CallLogModel`), không đổi sang live-query. Deviation có chủ đích so với SRS, ghi nhận lại ở đây.

SRS (mục "Bảng lịch sử cuộc gọi", CRM.04.2) ghi rõ:

> Khi người dùng vừa truy cập vào màn hình, hệ thống mặc định gọi API
> **`POST /api/v3/call-transaction/search`** (không truyền tham số bộ lọc) để lấy 50 bản ghi mới nhất
> hiển thị lên bảng.
> **Lưu ý dữ liệu:** Nguồn data lịch sử được đồng bộ **trực tiếp** từ hệ thống tổng đài Omicall.

→ SRS kỳ vọng màn "Lịch sử cuộc gọi" là **live query trực tiếp sang Omicall mỗi lần vào màn** (kiểu
proxy/passthrough), các dropdown lọc (thời gian/nhân viên/hướng gọi) đều mô tả "Gọi lại API
`call-transaction/search`" với tham số tương ứng.

Code hiện tại (`handle-omicall-webhook.service.ts` + `list-call-history.service.ts`) đi theo hướng
khác hẳn: webhook CDR từ Omicall được lưu vào **`CallLogModel`** (DB của mình), màn lịch sử
(`GET /customer-call/history`) đọc từ DB này, không gọi Omicall API tại thời điểm request.

**Lý do kỹ thuật của cách đã làm** (không có trong SRS, tự suy luận lúc build):
- Không phụ thuộc Omicall còn sống hay không tại thời điểm user xem lịch sử.
- Join được thẳng với `Customer`/`UserInfo` của mình (tên khách hàng, sale phụ trách) mà
  `call-transaction/search` của Omicall không có.
- Không bị giới hạn cứng **50 bản ghi/trang** của Omicall (`size max = 50` — xem BR_03 CRM.04.2).
- Phân trang/lọc chạy trên MongoDB của mình, nhanh hơn round-trip ra ngoài mỗi lần thao tác.

**Kéo theo 2 hệ quả trực tiếp:**

### 0.1. Cột "Cước phí" — công thức làm tròn khác nhau — ✅ ĐÃ CHỐT (03-09-2026)

SRS (cột `m. Cột cước phí`, CRM.04.2): gọi `GET /api/v2/callTransaction/getByTransactionId` lấy
`call_out_price`, hiển thị VNĐ, **"làm tròn đến chữ số thập phân thứ 3"**.

**Đã sửa theo đúng SRS** — `CallHistoryTab.jsx` giờ dùng
`toLocaleString("vi-VN", { maximumFractionDigits: 3 })` (làm tròn tối đa 3 chữ số thập phân), không
còn `Math.round` số nguyên như bản trước. Vẫn đọc `call_out_price` từ `CallLogModel` (không gọi lại
`getByTransactionId` — giữ nguyên quyết định kiến trúc ở mục 0, không đụng tới nguồn dữ liệu).

### 0.2. Cột "Ghi chú" — SRS có hành vi sửa, code hiện tại chỉ đọc — ✅ ĐÃ LÀM (03-09-2026)

SRS (cột `n. Cột ghi chú`, CRM.04.2):

> **Hành vi Sửa ghi chú:** Khi Actor nhập Ghi chú mới và bấm Lưu (Enter), hệ thống gọi API
> `POST /api/call_transaction/change/:transaction_id`, truyền nội dung ghi chú vào payload `note`.

**Đã triển khai đầy đủ theo đúng SRS:**
- BE: permission mới `call_log.update_note` (catalog + seed grant cho `CRM_SALE`/`CRM_SALE_TEAM_LEAD`,
  cùng scope với `call_log.view`) → service `update-call-log-note.service.ts` (check tồn tại →
  `NotFoundException`, check scope → `ForbiddenException`, gọi `OmicallClient.updateCallTransaction()`
  thật, lỗi thì `ConflictException` và **không lưu note nửa vời**) → route
  `PATCH /customer-call/history/:id/note`. Có 4 test integration (`MongoMemoryServer`, mock
  `OmicallClient`), verify bằng revert-fail-restore.
- FE: `CallHistoryTab.jsx` — ô "Ghi chú" giờ là input gõ trực tiếp (component `NoteCell`), **lưu khi
  bấm Enter** (đúng SRS, không có nút Lưu riêng).

**Còn thiếu để chạy được trên môi trường thật:** phải chạy lại
`scripts/seedPermissionCatalog.ts` + `scripts/seedPermissionCrmRoles.ts` trên DB, rồi xoá cache Redis
quyền (`*:perm:employee:*`, xem lý do ở phần cache-không-TTL đã note trước đó) — nếu không, sale sẽ bị
403 dù code đã đúng.

---

## 1. CRM.04.1 — Xem danh sách khách hàng cần gọi

File liên quan: `src/modules/customer-call/application/list-customers-to-call.service.ts`,
`website-crm/src/pages/customer-call/CustomersToCallTab.jsx`.

| # | SRS (mã BR/FR) | Mô tả SRS | Hiện trạng code | Mức độ |
|---|---|---|---|---|
| 1.1 | BR_05, BR_06, FR_08 | Bộ lọc "Lần gọi" gồm: Chưa gọi, Gọi lần 1/2/3, **"Trên 3 lần"** (>3 gộp chung 1 nhóm) | ✅ Đã thêm option `value: "gt3"` (`CALL_COUNT_OPTIONS`), BE map thành `{ $gt: 3 }` thay vì `$eq` | ✅ Đã làm (03-09-2026), có test |
| 1.2 | FR_01, FR_02 | Bấm "Gọi ngay" → hiện **popup xác nhận** (Hủy / Xác nhận gọi) trước khi thực sự gọi | ✅ Đã làm — `Dialog` xác nhận trong `CustomersToCallTab.jsx`, Hủy bỏ = đóng không gọi, Xác nhận = ghi nhận lượt gọi rồi mới `makeOmiCall()` | ✅ Đã làm (03-09-2026) |
| 1.3 | FR_05 | Trong lúc gọi, hiện **popup riêng của app** show tên KH/SĐT/thời gian đang diễn ra | Chưa có — chỉ có widget nổi của chính SDK Omicall (không phải UI tự làm) | 🟡 Thiếu tính năng |
| 1.4 | FR_06, FR_07 | Khi cuộc gọi kết thúc (actor hoặc khách tắt máy) → đóng popup cuộc gọi, hiện **popup đánh giá + nhập ghi chú** | Chưa có | 🟡 Thiếu tính năng |
| 1.5 | BR_09, BR_11, FR_03, FR_04 | Khi actor **xác nhận gọi** (không phải khi cuộc gọi kết thúc), hệ thống phải tăng "Lần gọi" +1 và cập nhật "Liên hệ cuối" **ngay lập tức**, không phụ thuộc kết quả cuộc gọi | ✅ Đã làm — API mới `POST /customer-call/customers/:id/call-attempts` (`record-call-attempt.service.ts`) gọi ngay lúc xác nhận. Đã **gỡ** logic tăng count cũ khỏi `handleOmicallWebhook` (tránh đếm trùng — webhook giờ chỉ lưu CDR, không đụng stats nữa) | ✅ Đã làm (03-09-2026), có 4 test integration |
| 1.6 | Mục `k`, ID 0015 | Icon xem chi tiết → điều hướng sang màn "Thông tin chi tiết khách hàng" | ✅ Theo yêu cầu user, đổi thành bấm cả dòng (row) để điều hướng thay vì icon riêng — `TableRow` trong `CustomersToCallTab.jsx` `onClick` → `/khach-hang/:external_id`, có hover style, chặn propagation ở ô dropdown/nút gọi | ✅ Đã làm (03-09-2026) |
| 1.7 | Mục `a`, ID 0001 | Toggle dự án mặc định = **VNFITE** | ✅ Đã sửa `filters.appCode` mặc định thành `"vnfite"` | ✅ Đã sửa (03-09-2026) |
| 1.8 | Mục `c`, ID 0003 | Dropdown "Trạng thái" có **2 bộ giá trị khác nhau theo app**: TIKLUY dùng (Chưa eKYC/eKYC chưa ĐT/Đang đầu tư/Đã tất toán); app khác dùng (Chưa KYC/Chờ duyệt/Đã duyệt/Từ chối) | Chỉ có 1 bộ `CUSTOMER_STATUS_OPTIONS` cố định dùng chung mọi app — chưa phân biệt theo `appCode` | 🟡 Thiếu tính năng (chưa rõ app nào tương ứng "app khác" ngoài TIKLUY/VNFITE — SRS không nói rõ VNFITE dùng bộ nào) |

**Điểm khớp đúng, không có gap:** BR_01/02 (phân quyền xem theo scope), BR_03/04 (tách theo dự án +
tự tải lại khi đổi tab), BR_07/BR_08 (Trạng thái đọc-only, Tình trạng Sale sửa được qua dropdown),
BR_10/BR_12 (Liên hệ cuối dạng tương đối, để trống nếu chưa gọi), BR_13/14 (thông báo rỗng/lỗi tải),
BR_15 (giữ nguyên tình trạng cũ nếu update lỗi), FR_09/FR_10.

---

## 2. CRM.04.2 — Xem lịch sử cuộc gọi

File liên quan: `src/modules/customer-call/application/list-call-history.service.ts`,
`website-crm/src/pages/customer-call/CallHistoryTab.jsx`. Xem thêm mục 0 (gap kiến trúc nguồn dữ
liệu — áp dụng cho toàn bộ mục này).

| # | SRS (mã BR/FR) | Mô tả SRS | Hiện trạng code | Mức độ |
|---|---|---|---|---|
| 2.1 | (mục 0) | Nguồn dữ liệu = live query `call-transaction/search` mỗi lần vào màn | Đọc từ `CallLogModel` (đồng bộ qua webhook, không live-query) | ✅ Đã chốt (03-09-2026) — giữ nguyên, xem mục 0 |
| 2.2 | (mục 0.1) | Cước phí làm tròn **3 chữ số thập phân** | Đã sửa `toLocaleString("vi-VN", { maximumFractionDigits: 3 })` | ✅ Đã sửa (03-09-2026) — xem mục 0.1 |
| 2.3 | (mục 0.2) | Ghi chú **cho phép sửa**, gọi `updateCallTransaction` | Đã làm — BE + FE + test | ✅ Đã làm (03-09-2026) — xem mục 0.2 |
| 2.4 | BR_04 | Nút Play chỉ hiện khi **có file ghi âm VÀ thời lượng cuộc gọi > 0 giây** | ✅ Đã thêm điều kiện `callLog.duration > 0` | ✅ Đã sửa (03-09-2026) |
| 2.5 | BR_03 | Phân trang tối đa 50 bản ghi/trang (giới hạn cứng của API Omicall) | Không áp dụng — đã chốt giữ kiến trúc đọc từ DB riêng (mục 0), giới hạn 50 không còn bắt buộc | ✅ Không còn là gap (03-09-2026) |

**Điểm khớp đúng, không có gap:** BR_01 (tách theo TIKLUY/VNFITE), BR_02 (Sale tự xem, Trưởng nhóm
xem theo phòng ban — đã seed đúng `CALL_LOG_SELF_ASSIGNED`/`CALL_LOG_OWN_DEPARTMENT`), FR_01 (search
real-time theo tên/SĐT), cột Thời gian/Nhân viên/Khách hàng/Tổng thời gian/Thời lượng — map field
đúng hướng (`duration`/`bill_sec`), mục "Ghi âm - hiển thị play button kèm thời lượng" đúng logic
hiển thị (chỉ thiếu điều kiện phụ ở 2.4).

Lỗi đánh máy trong chính SRS (không phải bug code): mục cột "Thời gian" ghi *"Hướng gọi = Gọi vào →
... kèm nhãn 'Gọi đi'"* — rõ ràng copy nhầm từ dòng "Gọi đi" phía trên, đúng ra phải là "Gọi vào".

---

## 3. CRM.04.3 — Tổng đài (quản lý đầu số Hotline)

**✅ SRS đã đầy đủ (03-09-2026)** — bản trước (2 trang cuối file 29 trang) chỉ là placeholder lặp
lại mục 1. Bản SRS riêng, đầy đủ đã có: `vWork - CRM website - Tài liệu SRS (1).pdf` (mã tài liệu
`CRM.006`, phiên bản 1.0, 27-08-2026, DatMN).

**Use case CRM.04.3 — Quản lý Đầu Số Hotline**

- **Actor:** chỉ **Admin** (khác CRM.04.1/2 — Sale/Manager tự xem theo scope).
- **Kích hoạt:** chọn tab "Đầu Số Hotline" trong phân hệ "Tổng đài".
- **Luồng chính:** vào màn → hệ thống load danh sách Hotline dạng **Card** → Admin click "Cấu hình"
  trên 1 Card → popup → chỉnh gọi vào/gọi ra/kịch bản/phạm vi quyền/danh sách NV → "Lưu cấu hình" →
  gọi API update → đóng popup, toast, tải lại danh sách.
- **Luồng thất bại:** API cấu hình lỗi (kết nối Omicall) → toast "Cập nhật cấu hình thất bại, vui
  lòng thử lại".

**Business Rules:**

| ID | Mô tả |
|---|---|
| BR_01 | Danh sách Hotline đồng bộ **trực tiếp từ Omicall**, CRM **không lưu DB** — chỉ đóng vai trò phân quyền/cấu hình. Không cần model Mongoose mới, mọi thao tác proxy thẳng qua `omicallClient.ts`. |
| BR_02 | Để NV gọi ra được bằng 1 đầu số, Admin bắt buộc bật `allow_call_out` + chọn "Phạm vi quyền gọi ra". |
| BR_03 | `access_type = applies_to_all_employees` → toàn bộ NV có SIP dùng được. `access_type = applies_according_to_employee_criteria` → Admin tick chọn đích danh Extension. |

**Functional Requirements → API Omicall cần thêm vào `omicallClient.ts` (chưa có):**

| ID | API | Việc |
|---|---|---|
| FR_01 | `GET /api/call_center/hotline/search` | Danh sách Hotline |
| FR_01 | `GET /api/call_center/hotline/by-phone` | Chi tiết 1 Hotline |
| FR_02/03 | (nằm trong FR_05, không phải API riêng) | Toggle gọi vào (`allow_call_in`) / gọi ra (`allow_call_out`) — local UI trước, gửi kèm lúc lưu |
| FR_04 | (nằm trong FR_05) | `access_type` + danh sách `group_ids`/`sip_users` khi phạm vi = theo phân quyền cụ thể |
| FR_05 | `PUT /api/call_center/hotline/update` | Lưu cấu hình (gửi `allow_call_in`, `allow_call_out`, `access_type`, `group_ids` hoặc `sip_users`) |

**Mockup — Card danh sách (ID 0001):** Số Hotline, badge Active/Inactive, trạng thái Gọi vào/Gọi ra
(bật/tắt), Kịch bản đang áp dụng, Hạn sử dụng, Quyền sử dụng (vd "Toàn bộ NV" / "3 NV được phép" /
"Chỉ Admin"), nút "Cấu Hình".

**Mockup — Popup cấu hình (ID 0002):** Tiêu đề "Cấu Hình: [Số Hotline]"; Toggle 1 = gọi VÀO
(`allow_call_in`); Toggle 2 = gọi RA (`allow_call_out`); Dropdown 1 = kịch bản mặc định
(`call_script`); Dropdown 2 = phạm vi quyền gọi ra (`access_type`, 2 giá trị); danh sách Badge
Extension (chỉ hiện khi Dropdown 2 = "Theo phân quyền cụ thể", click để chọn/bỏ chọn); nút Hủy /
Lưu cấu hình.

**✅ Đã build (03-09-2026).** Đúng như đề xuất — feature thuần proxy qua Omicall, không có domain
Entity/Repository/DB, route Admin-only bằng `isAdmin` (giống pattern `crm-sale-admin.routes.ts`,
không dùng `requirePermission` vì BR nói rõ chỉ Admin).

Backend:
- `src/utils/omicallClient.ts` — thêm `searchHotlines`, `getHotlineByPhone`, `updateHotlineConfig`,
  `listCallScripts`, `listInternalPhones` + type tương ứng, đúng contract trong `Tài liệu API.xlsx`
  (`/api/call_center/hotline/search|by-phone|update`, `/call_script/list`, `/internal_phone/list`).
- `src/modules/customer-call/application/list-hotlines.service.ts`,
  `get-hotline-detail.service.ts` (throw `NotFoundException` nếu Omicall trả null),
  `update-hotline-config.service.ts` (validate `accessType`, bắt buộc extensions/groupIds khi
  `applies_according_to_employee_criteria`, wrap lỗi Omicall thành `ConflictException` — cùng
  pattern `update-call-log-note.service.ts`), `list-hotline-call-scripts.service.ts`,
  `list-hotline-extensions.service.ts` — đều mới.
- `src/modules/customer-call/interface/hotline-admin.http.controller.ts` +
  `hotline-admin.routes.ts` — mount tại `/customer-call/admin/hotlines`,
  `/customer-call/admin/hotline-call-scripts`, `/customer-call/admin/hotline-extensions`, đăng ký
  trong `src/routes/index.js`.
- `__tests__/customerCallHotlineAdmin.test.ts` — 6 test (mock `OmicallClient`), verify bằng
  revert-fail-restore: NotFound khi Omicall trả null, ArgumentInvalid khi accessType sai/thiếu
  extensions, ConflictException khi Omicall lỗi.

Frontend:
- `src/features/customer-call/apis/hotlineAdmin.js`, `hooks/useHotlineAdminQuery.js`,
  `constants/hotlineAdmin.constants.js` — mới.
- `src/pages/hotline/HotlineManagementScreen.jsx` — mới, Card grid + popup cấu hình
  (Toggle gọi vào/ra, Dropdown kịch bản, Dropdown phạm vi quyền, Badge chọn Extension).
- Route `/tong-dai` (`router/MainRoutes.jsx`) + menu "Tổng đài" trong `AdminMenu`
  (`CrmMenuItems.js`).

**Điểm còn giả định, chưa verify được với Omicall thật** (không có sandbox/credentials để test
end-to-end trong phiên này — cần Admin thật thử trên môi trường có kết nối Omicall thật):
- Shape chính xác của field `accesses` (SRS/Excel chỉ ghi "Array", không nói rõ item là string hay
  object) — code xử lý cả 2 trường hợp (`normalizeAccessEntry`) nhưng chưa chạy được với data thật.
- Field `allow_call_in`/`allow_call_out` trong `hotline/update` được Excel đánh kiểu String — code
  gửi `String(true/false)` theo đúng doc, nhưng chưa xác nhận Omicall có chấp nhận boolean thay vì
  string hay không.

---

## 4. Việc cần PM/dev chốt trước khi code tiếp

- [x] **Cước phí (0.1):** ✅ 03-09-2026 — đổi về làm tròn 3 chữ số thập phân theo SRS. Đã sửa.
- [x] **Ghi chú (0.2):** ✅ 03-09-2026 — đã làm tính năng sửa note gọi thẳng Omicall
      (`updateCallTransaction`), BE + FE + test đầy đủ.
- [x] **Kiến trúc nguồn dữ liệu lịch sử cuộc gọi (mục 0):** ✅ 03-09-2026 — giữ nguyên webhook +
      `CallLogModel`, không đổi sang live-query. Deviation có chủ đích, ghi nhận trong mục 0.
- [x] **Luồng popup xác nhận gọi + tăng Lần gọi ngay lúc xác nhận (1.2, 1.5):** ✅ 03-09-2026 — đã
      làm xong FR_01/02 (popup Hủy/Xác nhận) + BR_09/BR_11/FR_03/FR_04 (tăng ngay lúc xác nhận, tách
      khỏi webhook). **Chưa làm** FR_05 (popup hiện trạng thái đang gọi) và FR_06/FR_07 (popup đánh
      giá + ghi chú sau khi cuộc gọi kết thúc) — 2 việc này (mục 1.3, 1.4) vẫn còn mở, phụ thuộc vào
      việc đọc state từ SDK Omicall (`useOmiCall.js`'s `handleAccepted`/`handleEnded`, hiện chỉ log
      console, chưa có state quản lý ở tầng UI).
- [ ] **Bộ giá trị Trạng thái theo app (1.8):** SRS chỉ mô tả rõ cho TIKLUY, "app khác" dùng KYC —
      cần hỏi lại VNFITE thuộc nhóm nào.
- [x] **CRM.04.3 (Tổng đài):** ✅ 03-09-2026 — SRS riêng (`CRM.006`) đã đầy đủ, đã build xong BE+FE.
      Còn 2 điểm cần verify với Omicall thật (shape `accesses`, kiểu `allow_call_in`/`out`) — xem
      mục 3.

## 5. Đề xuất thứ tự ưu tiên (chưa làm, chờ PM duyệt)

1. Sửa nhanh, rủi ro thấp: 1.7 (default VNFITE), 2.4 (điều kiện thời lượng > 0 cho nút Play).
2. Bộ lọc "Trên 3 lần" (1.1) — độc lập, không đụng phần khác.
3. Luồng popup xác nhận gọi + ghi nhận lượt gọi ngay lúc xác nhận (1.2-1.5) — việc lớn nhất, ảnh
   hưởng UX chính của màn hình.
4. Icon xem chi tiết khách hàng (1.6) — cần màn "Thông tin chi tiết khách hàng" đã tồn tại chưa,
   kiểm tra trước khi làm.
5. Ghi chú sửa được (0.2) + cước phí làm tròn 3 số (0.1) — làm cùng lúc vì cùng đụng
   `CallHistoryTab.jsx`.
6. ✅ CRM.04.3 — đã làm (03-09-2026).
