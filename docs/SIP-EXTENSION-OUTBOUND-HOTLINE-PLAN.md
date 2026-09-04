# Popup "Cấu hình SIP Extension" — Kế hoạch triển khai

**✅ Đã build xong (03-09-2026).**

Nguồn: mockup UI do user cung cấp (popup "Cấu hình SIP Extension" ở màn `CrmSaleSyncScreen.jsx`,
đường dẫn `/dong-bo-sip`) + `Tài liệu API.xlsx` (API thật của Omicall). Thay thế popup hiện tại (chỉ
sinh + hiện mật khẩu SIP mới) bằng popup đầy đủ hơn, thêm phần chọn "Đầu số gọi ra (Outbound)".

**Tổng kết triển khai:**

Backend:
- `src/modules/customer-call/application/assign-extension-outbound-hotline.service.ts` — mới, hàm
  `assignExtensionOutboundHotline(employeeId, hotlineNumber)` đúng logic mục 2.1 (no-op nếu
  `access_type = applies_to_all_employees` hoặc sipUser đã có sẵn; merge additive-only khi cần thêm).
- `crm-sale-admin.http.controller.ts`/`crm-sale-admin.routes.ts` — thêm
  `PATCH /customer-call/admin/employees/:employeeId/outbound-hotline`.
- `__tests__/customerCallAssignOutboundHotline.test.ts` — 5 test, revert-fail-restore verify 2 nhánh
  no-op (fail đúng điểm khi tắt từng check).
- `npx jest permission customerCall`: 128/128 pass.

Frontend:
- `apis/crmSaleAdmin.js`, `hooks/useCrmSaleAdminQuery.js` — thêm `assignOutboundHotlineApi`/
  `useAssignOutboundHotlineMutation`.
- `CrmSaleSyncScreen.jsx` — thay hẳn popup cũ (chỉ hiện mật khẩu sau khi generate) bằng
  `SipConfigModal`: banner tên NV + SIP, field mật khẩu (dots + icon con mắt toggle, nút "Tạo mật
  khẩu mới" riêng biệt gọi ngay `useConfigureCrmSaleSipPasswordMutation`), dropdown "Đầu số gọi ra"
  load từ `useGetHotlinesQuery()` (tái dùng từ tính năng Tổng đài), nút "Lưu cấu hình" chỉ gọi
  `useAssignOutboundHotlineMutation`. Bỏ hẳn field "Ghi âm cuộc gọi" theo quyết định mục 1.

Verify: `tsc`/eslint sạch (BE+FE), `vite build` thành công, không regression trên suite hiện có.

---

## 0. Mockup gốc

Popup gồm 4 phần:
- Header: icon ⚙️ + "Cấu hình SIP Extension" + nút đóng (X).
- Banner xanh nhạt: `{Tên nhân viên} đang dùng SIP {số extension}`.
- Field "MẬT KHẨU SIP": ô hiển thị dạng password (dots) — bổ sung thêm icon con mắt để xem/ẩn mật
  khẩu (không có trong ảnh mockup gốc, thêm theo yêu cầu sau).
- Field "ĐẦU SỐ GỌI RA (OUTBOUND)": dropdown, ví dụ `0987654321 (Hotline VP)`.
- Field "GHI ÂM CUỘC GỌI": dropdown, ví dụ `Bật (Bắt buộc)`.
- Footer: Hủy / **Lưu cấu hình** (nút xanh).

## 1. Đối chiếu với API Omicall thật — quyết định đã chốt

Rà lại `Tài liệu API.xlsx`, phát hiện 2/4 field trên **không có API tương ứng**. Đã hỏi lại user và
chốt:

| Field mockup | Có API không? | Quyết định |
|---|---|---|
| **Mật khẩu SIP** | ✅ Có — `POST /api/call_center/internal_phone/update` (field `password`) | **Giữ nguyên cơ chế tự generate** (như hiện tại `configureCrmSaleSipPassword`), chỉ đổi UI hiển thị theo layout mockup — không cho admin gõ tay mật khẩu. |
| **Đầu số gọi ra (Outbound)** | ⚠️ Không có API "set hotline mặc định cho 1 extension". Chỉ có chiều ngược: `PUT hotline/update` set "extension nào được dùng hotline X" (đã build ở màn Tổng đài — mục CRM.04.3). | **Vẫn làm dropdown chọn được**, nhưng implement bằng cách gọi ngược `updateHotlineConfig` của hotline được chọn, **thêm** sipUser vào `extensions` của nó — xem mục 2. |
| **Ghi âm cuộc gọi** | ❌ Không tìm thấy field/API nào trong tài liệu Omicall cho việc này | **Bỏ khỏi popup** — không dựng UI cho thứ không lưu được. |

**Quyết định quan trọng khác đã chốt:** khi admin chọn hotline X cho 1 extension, hệ thống **chỉ
thêm** extension đó vào X, **giữ nguyên** các hotline khác mà extension đang được phép dùng (không gỡ
khỏi hotline khác) — additive-only, không phải "single-select thay thế toàn bộ". Lý do: tránh phải
gọi `GET hotline/list?extension=` + fetch/update hàng loạt hotline khác (nhiều round-trip hơn, rủi ro
nửa vời nếu 1 bước lỗi giữa chừng), và đúng bản chất dữ liệu Omicall (1 extension có thể thuộc nhiều
hotline cùng lúc, không có khái niệm "hotline mặc định duy nhất").

---

## 2. Backend

### 2.1. Service mới: `assign-extension-outbound-hotline.service.ts`

File: `src/modules/customer-call/application/assign-extension-outbound-hotline.service.ts`

```
assignExtensionOutboundHotline(employeeId: string, hotlineNumber: string): Promise<void>
```

Logic:
1. Tra `SaleOmicallProfileRepository.findBySaleId(employeeId)` → lấy `sipUser`. Không có profile →
   `NotFoundException("Nhân viên chưa có SIP profile để cấu hình")` — **đúng message/pattern** đã
   dùng trong `configureCrmSaleSipPassword`.
2. Gọi `getHotlineDetail(hotlineNumber)` (đã có sẵn, tái dùng) → lấy `configs` + `accesses` hiện tại.
3. Nếu `configs.access_type === "applies_to_all_employees"` → toàn bộ NV đã gọi ra được qua hotline
   này rồi → **no-op**, return luôn, không gọi Omicall.
4. Lấy `existingExtensions` từ `detail.accesses[].name` (đúng field thật đã xác nhận ở phiên trước —
   xem `docs/CRM-CALL-SRS-GAP-ANALYSIS.md` mục 3, phần "accesses nằm ở top-level hotline, không phải
   trong configs"). Nếu `sipUser` đã có trong đó → **no-op**, return, tránh gọi Omicall thừa.
5. Ngược lại: gọi `updateHotlineConfig(hotlineNumber, {...})` (đã có sẵn, tái dùng) với:
   - `allowCallIn`/`allowCallOut`/`callScript`: giữ nguyên từ `configs` hiện tại (không đổi).
   - `accessType: "applies_according_to_employee_criteria"`.
   - `extensions: [...existingExtensions, sipUser]` (merge, không xóa extension cũ nào).

**Không cần thêm Omicall API mới** — toàn bộ tái dùng `getHotlineDetail`/`updateHotlineConfig` đã
build ở tính năng Tổng đài, và `SaleOmicallProfileRepository` đã có sẵn từ module SIP sync.

### 2.2. Route + Controller

Thêm vào **`crm-sale-admin.routes.ts`** (cùng nhóm route SIP hiện có, không phải `hotline-admin.routes.ts`
— vì entry point là theo `employeeId`, khớp sibling routes `/sip-password`, `/sync-sip`):

```
PATCH /customer-call/admin/employees/:employeeId/outbound-hotline
Body: { hotlineNumber: string }
```

- Middleware: `authenticate`, `isAdmin` (giống mọi route khác trong file này).
- Controller method mới `assignExtensionOutboundHotline` trong `crm-sale-admin.http.controller.ts` —
  validate `hotlineNumber` là string non-empty (`ArgumentInvalidException` nếu không), gọi service,
  trả `{ message: "Đã gán đầu số gọi ra" }`.

### 2.3. Test (bắt buộc theo quy ước: revert-fail-restore từng nhánh)

File: thêm vào `__tests__/customerCallHotlineAdmin.test.ts` hoặc file mới
`customerCallAssignOutboundHotline.test.ts` (mock `OmicallClient`, không cần DB thật cho phần Omicall,
chỉ cần `SaleOmicallProfileModel` + `UserInfoModel`/`AccountModel` cho phần tra `employeeId → sipUser`).

Case cần cover:
- Employee chưa có `SaleOmicallProfile` → `NotFoundException`, không gọi Omicall.
- Hotline `access_type = applies_to_all_employees` → no-op, không gọi `updateHotlineConfig`.
- `sipUser` đã có sẵn trong `accesses` → no-op, không gọi `updateHotlineConfig`.
- `sipUser` chưa có → gọi đúng `updateHotlineConfig` với `extensions` = merge đúng (giữ nguyên
  extension cũ + thêm mới), `accessType` đúng.
- Hotline không tồn tại → bubble `NotFoundException` từ `getHotlineDetail` (đã có sẵn, chỉ cần assert
  lại, không cần code thêm).

---

## 3. Frontend

### 3.1. API + hook mới

- `src/features/customer-call/apis/crmSaleAdmin.js` — thêm
  `assignOutboundHotlineApi(employeeId, hotlineNumber)` →
  `PATCH /customer-call/admin/employees/${employeeId}/outbound-hotline`.
- `src/features/customer-call/hooks/useCrmSaleAdminQuery.js` — thêm
  `useAssignOutboundHotlineMutation()`.

### 3.2. Viết lại popup trong `CrmSaleSyncScreen.jsx`

Thay đổi hành vi bấm icon ⚙️: **không** generate mật khẩu ngay lập tức như hiện tại — thay vào đó mở
popup "Cấu hình SIP Extension":

- Header: icon gear + "Cấu hình SIP Extension" + nút đóng (X) — style theo `HotlineManagementScreen.jsx`
  đã làm (dùng lại `ACCENT`/`ACCENT_GRADIENT` = `colors.WPR`/`colors.WPRHover` cho đồng bộ hệ thống).
- Banner: `{fullName} đang dùng SIP {omicallExtension}`.
- Section "MẬT KHẨU SIP": ô password (dots, readonly) + icon con mắt để toggle hiện/ẩn mật khẩu dạng
  plain text (state FE thuần, không gọi API) + nút nhỏ "Tạo mật khẩu mới" cạnh đó — bấm nút mới thực
  sự gọi `useConfigureCrmSaleSipPasswordMutation` (tái dùng y nguyên, không đổi logic), điền kết quả
  vào ô. Đây là **hành động độc lập**, bấm là lưu ngay (giữ nguyên hành vi cũ), không phụ thuộc nút
  "Lưu cấu hình" ở footer. Mặc định ẩn (dots) mỗi khi popup mở lại, không nhớ trạng thái hiện giữa các
  lần mở.
- Section "ĐẦU SỐ GỌI RA (OUTBOUND)": `<Select>` load từ `useGetHotlinesQuery()` (đã có sẵn từ tính
  năng Tổng đài) — hiện danh sách hotline (số + trạng thái Active/Inactive).
- **Bỏ hẳn** section "Ghi âm cuộc gọi".
- Footer: Hủy / "Lưu cấu hình" — nút này **chỉ** gọi `useAssignOutboundHotlineMutation` (lưu phần chọn
  hotline), disable nếu chưa chọn hotline nào.

### 3.3. Verify

- `tsc --noEmit`, `eslint` (BE + FE) sạch.
- `npx jest permission customerCall` — không regression.
- `npx vite build` — thành công, có chunk mới nếu tách file.
- Test UI thủ công (không có Omicall sandbox thật trong phiên này — như đã ghi nhận ở
  `CRM-CALL-SRS-GAP-ANALYSIS.md` mục 3, phần "giả định chưa verify").

---

## 4. Rủi ro / giả định còn mở

- `configs.default_script` khi rỗng (`null`) — `updateHotlineConfig` hiện chỉ gửi `call_script` nếu
  có giá trị (`...(input.callScript ? {...} : {})`), nên giữ nguyên hành vi "không đổi kịch bản" khi
  hotline chưa có kịch bản mặc định — không phải bug, chỉ ghi chú lại để không nhầm khi review.
- Nếu `sipUser` của nhân viên đổi sau này (hiếm, hiện không có workflow nào cho phép đổi số extension
  của 1 account đã tồn tại — xem phần trả lời "flow đồng bộ số nội bộ" trong phiên trước), các hotline
  đã gán trước đó theo `sipUser` cũ sẽ không tự cập nhật — chấp nhận được vì đây cũng là giới hạn hiện
  tại của toàn bộ hệ thống, không riêng tính năng này.
