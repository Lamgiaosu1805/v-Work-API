# Global App Switcher (VNFITE/TIKLUY) tại logo — Kế hoạch triển khai

**✅ Toàn bộ đã build xong (04-09-2026)** — xem mục 4 và mục 5 để biết chi tiết. Mục 2.4 (các màn
hardcode tikluy) đã được xác nhận và xử lý xong — chuyển sang dùng global switcher.

Nguồn: `~/Downloads/wireframe-crm-p2p-sidebar.html` (wireframe lo-fi tương tác) + `~/Downloads/vWork -
CRM website - Tài liệu SRS (1).docx` (bảng mapping Tab/Sub-tab → màn CRM cũ → mã quyền) + khảo sát
trực tiếp code `website-crm/src` hiện có.

**Đã chốt (04-09-2026)**: sidebar CRM **dùng chung 1 cấu trúc** cho cả VNFITE và TIKLUY — không có
logic ẩn/hiện menu item theo app. Khác biệt giữa 2 app chỉ nằm ở **data** (kết quả API trả về theo
`app_code`), không phải cấu trúc điều hướng. Vì vậy **bỏ hẳn** ý tưởng "redesign sidebar theo IA SRS"
ở bản kế hoạch trước — không cần đổi `CrmMenuItems.js`. Phạm vi việc thật sự: **bỏ bộ lọc VNFITE/TIKLUY
cục bộ trong từng màn**, thay bằng 1 **global switcher đặt ở logo**; giá trị `appCode` toàn cục này
được dùng để build param mỗi khi 1 API cần `app_code`.

---

## 0. Đối chiếu SRS — chỉ còn giá trị tham khảo cho "màn nào cần app_code", không dùng để thiết kế sidebar

2 bảng SRS (VNFITE/TIKLUY) trong docx liệt kê tab/sub-tab kèm mã quyền — vẫn hữu ích để biết **màn nào
gắn với nghiệp vụ theo app** (nên đọc `appCode` toàn cục) vs **màn không phân biệt app** (Tổng đài,
quản trị SIP...). Đã đối chiếu, xem mục 1.

---

## 1. Khảo sát toàn bộ nơi đang dùng `appCode`/`app_code` trong code hiện tại

### 1.1 Màn có UI chọn app cục bộ (cần bỏ UI, đọc từ global)

| File | UI hiện tại |
|---|---|
| `CustomerScreen.jsx` | `APP_CODE_OPTIONS` + `ToggleButtonGroup` local |
| `MyCustomerScreen.jsx` | `APP_CODE_OPTIONS` + `ToggleButtonGroup` local |
| `CrmExecutiveDashboard.jsx` | `ToggleButtonGroup` local (dashboard) |
| `CustomerCallScreen.jsx` | `useState` local (đã lift từ `CustomersToCallTab`/`CallHistoryTab` ở phiên trước) |

### 1.2 Màn hardcode `APP_CODE = "tikluy"` — không có UI chọn, luôn cố định

`ClaimRequestScreen.jsx`, `CSKHScreen.jsx`, `AgenciesScreen.jsx`.

### 1.3 Màn/API không liên quan `app_code` (không đụng)

`HotlineManagementScreen.jsx` (Tổng đài — dùng chung 1 Omicall instance, không phân theo app),
`CrmSaleSyncScreen.jsx` (quản trị SIP nhân viên, không phân theo app).

---

## 2. Global App Switcher

### 2.1 Vị trí đặt

Đặt tại khu vực logo — `LogoSection.jsx` (dùng chung HRM + CRM, hiện ở **App Bar** trên desktop, hiện
ở **Drawer header** trên mobile, cùng 1 component). Tái dùng đúng pattern UI đã có sẵn trong
`Header.jsx`: nút "module-switcher" (chuyển HRM/CRM/Workplace, dùng `Menu` + `MenuItem`, style card bo
góc, xem dòng ~400-450) — dựng 1 switcher tương tự cho VNFITE/TIKLUY, đặt cạnh `LogoSection`, **chỉ
hiện khi đang ở layout CRM** (không hiện ở HRM/Workplace, vì app-switch không có ý nghĩa ở đó).

### 2.2 State toàn cục

Tạo Zustand store mới, `src/store/slices/crmCompany.js`, theo đúng pattern `authStore.js` (middleware
`persist`, lưu `localStorage` để giữ lựa chọn qua lần reload trang):

```js
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useCrmCompanyStore = create(
  persist(
    (set) => ({
      appCode: "vnfite", // mặc định — khớp quyết định "VNFITE bên trái vì là mặc định" đã chốt trước
      setAppCode: (appCode) => set({ appCode })
    }),
    { name: "crm-company" }
  )
);
```

### 2.3 Refactor 4 màn ở mục 1.1 — bỏ UI local, đọc global

Mỗi màn: xoá `APP_CODE_OPTIONS`/`ToggleButtonGroup`/`useState` cục bộ, thay bằng
`const appCode = useCrmCompanyStore((s) => s.appCode)`, dùng thẳng trong query param. `CustomerCallScreen.jsx`
xoá luôn `useState` đã lift trước đó — 2 con `CustomersToCallTab`/`CallHistoryTab` không cần đổi gì
(vẫn nhận `appCode` qua props như hiện tại, chỉ nguồn prop đổi từ local state sang global store).

Sau refactor: **UI chọn app biến mất khỏi cả 4 màn**, chỉ còn đúng 1 chỗ chọn — switcher ở logo.

### 2.4 3 màn hardcode `APP_CODE="tikluy"` (mục 1.2) — đổi luôn hay giữ nguyên?

Theo yêu cầu "khi gọi tới những API cần truyền app code sẽ truyền [global appCode]" — hiểu là áp dụng
cho **toàn bộ** API cần `app_code`, kể cả 3 màn này. Nhưng đây là đổi hành vi nghiệp vụ thật (từ "luôn
trả dữ liệu Tikluy" sang "theo lựa chọn global") — cần xác nhận rõ trước khi đổi, vì:

- Nếu VNFITE thực sự chưa có data/nghiệp vụ CTV-Đại lý/CSKH/Claim (business chưa mở), đổi sang đọc
  global mà không có gì để hiện sẽ ra màn trắng/rỗng khi user chọn VNFITE ở 3 màn này — không phải bug
  code, nhưng trải nghiệm xấu nếu không có thông báo phù hợp.
- Nếu đây chỉ là chưa làm xong (gap), đổi sang global là đúng hướng, không cần thêm gì khác.

**Chưa tự ý đổi 3 file này — chờ xác nhận.**

---

## 3. Đề xuất thứ tự triển khai

1. Tạo `useCrmCompanyStore` (mục 2.2).
2. Dựng UI switcher tại logo (mục 2.1), mặc định `"vnfite"`.
3. Refactor 4 màn ở mục 2.3 — bỏ toggle cục bộ, đọc global.
4. Verify: `eslint` + `vite build`, test tay đổi app ở switcher → cả 4 màn tự cập nhật data đồng bộ,
   giá trị được nhớ lại sau khi reload trang (persist).
5. Chờ xác nhận mục 2.4 rồi xử lý 3 màn hardcode tikluy (việc riêng, không gộp vào đợt 1-4).

---

## 4. Kết quả triển khai (04-09-2026)

**File mới:**
- `src/constants/crmCompany.js` — `CRM_COMPANY_OPTIONS` (nguồn chung duy nhất, thay 3 bản định nghĩa
  trùng lặp trước đó ở `CustomerScreen.jsx`/`MyCustomerScreen.jsx`/`CrmExecutiveDashboard.jsx`).
- `src/store/slices/crmCompany.js` — `useCrmCompanyStore`, `persist` vào `localStorage` (key
  `crm-company`), mặc định `appCode: "vnfite"`.

**`Header.jsx`** — thêm nút switcher (pattern UI mirror "module-switcher" có sẵn), đặt ngay sau
`LogoSection`, chỉ hiện khi `title === "Customer Relationship Management"` (tức đang ở layout CRM).
Click mở `Menu` chọn VNFITE/TIKLUY, gọi `setAppCode`.

**4 màn đã refactor** (bỏ toggle cục bộ `ToggleButtonGroup`, đọc `useCrmCompanyStore((s) => s.appCode)`
trực tiếp, thêm `useEffect` reset trang/state phụ thuộc khi `appCode` đổi):
- `CustomerScreen.jsx`
- `MyCustomerScreen.jsx`
- `CrmExecutiveDashboard.jsx`
- `CustomerCallScreen.jsx` + 2 con `CustomersToCallTab.jsx`/`CallHistoryTab.jsx` — bỏ hẳn pattern
  lift-state (`appCode`/`onAppCodeChange` props) từ phiên trước, 2 tab con giờ tự đọc thẳng từ store,
  không cần nhận qua props cha nữa.

Xóa luôn `APP_CODE_OPTIONS` khỏi `customerCall.constants.js` (không còn ai dùng sau refactor).

**Verify:** `eslint` sạch trên toàn bộ file mới/sửa (5 lỗi còn lại trong `MyCustomerScreen.jsx` đã xác
nhận bằng `git stash` là pre-existing, không liên quan thay đổi này). `vite build` thành công.

---

## 5. Mục 2.4 — đã xác nhận và xử lý xong (04-09-2026)

Người dùng chốt: áp dụng global switcher cho toàn bộ API cần `app_code`, kể cả các màn trước đó
hardcode tikluy. Đã refactor thêm 4 file (bỏ `const APP_CODE = "tikluy"`, đọc
`useCrmCompanyStore((s) => s.appCode)`):

- `ClaimRequestScreen.jsx` — chỉ `SubmitView`'s `handleSubmit` dùng `app_code`.
- `CSKHScreen.jsx` — dùng ở `useCSKH({app_code})` và `createMutation` (tạo claim period); thêm
  `useEffect` reset `page` về 0 khi `appCode` đổi.
- `AgenciesScreen.jsx` — dùng ở `useAgentsQuery({app_code})`; thêm `useEffect` reset `page` về 1.
- `ClaimRequestModal.jsx` (phát hiện thêm trong lúc code, không có trong khảo sát ban đầu — cũng
  hardcode tikluy, dùng trong `MyCustomerScreen`) — dùng ở `submit({app_code})`.

**Verify:** `eslint` sạch trên cả 4 file (lỗi còn lại đã xác nhận bằng `git stash` là pre-existing,
không liên quan). `vite build` thành công.

Đến đây, **toàn bộ nơi gọi API có tham số `app_code` trong CRM đều đọc từ global switcher** — không
còn bộ lọc VNFITE/TIKLUY cục bộ nào trong code.
