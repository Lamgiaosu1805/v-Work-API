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

### 0.2. Cột "Ghi chú" — SRS có hành vi sửa, code hiện tại chỉ đọc

SRS (cột `n. Cột ghi chú`, CRM.04.2):

> **Hành vi Sửa ghi chú:** Khi Actor nhập Ghi chú mới và bấm Lưu (Enter), hệ thống gọi API
> `POST /api/call_transaction/change/:transaction_id`, truyền nội dung ghi chú vào payload `note`.

Code hiện tại: cột "Ghi chú" trong `CallHistoryTab.jsx` **chỉ hiển thị** field `note` có sẵn (luôn
rỗng vì Omicall không tự gửi note qua CDR webhook) — không có UI nhập/sửa. Đây là quyết định đã hỏi
và PM chọn lúc đó ("chỉ hiển thị, để trống cho tới phase sau") — **nhưng lúc hỏi không có SRS trong
tay**, và SRS thực ra đã có đặc tả rõ hành vi này.

Method `OmicallClient.updateCallTransaction()` (map đúng
`POST /api/call_transaction/change/:transaction_id`) **đã tồn tại sẵn** trong
`src/utils/omicallClient.ts` từ Phase 1 nhưng **chưa từng được gọi ở bất kỳ đâu** trong toàn bộ
codebase.

→ **Cần chốt: có làm tính năng sửa ghi chú ngay bây giờ không?** Nếu có, cần thêm: 1 API mới
(`PATCH /customer-call/history/:id/note` hoặc gọi thẳng `updateCallTransaction` bằng `transaction_id`)
+ input UI (dạng "nhập rồi Enter để lưu" theo đúng SRS, không phải nút Lưu riêng).

---

## 1. CRM.04.1 — Xem danh sách khách hàng cần gọi

File liên quan: `src/modules/customer-call/application/list-customers-to-call.service.ts`,
`website-crm/src/pages/customer-call/CustomersToCallTab.jsx`.

| # | SRS (mã BR/FR) | Mô tả SRS | Hiện trạng code | Mức độ |
|---|---|---|---|---|
| 1.1 | BR_05, BR_06, FR_08 | Bộ lọc "Lần gọi" gồm: Chưa gọi, Gọi lần 1/2/3, **"Trên 3 lần"** (>3 gộp chung 1 nhóm) | `CALL_COUNT_OPTIONS` chỉ có giá trị đúng 0/1/2/3; BE so khớp `callCount` bằng `$eq` chính xác — **không có bucket "Trên 3 lần"** | 🟡 Thiếu tính năng |
| 1.2 | FR_01, FR_02 | Bấm "Gọi ngay" → hiện **popup xác nhận** (Hủy / Xác nhận gọi) trước khi thực sự gọi | `handleCallNow` gọi thẳng `makeOmiCall()`, không có popup xác nhận | 🟡 Thiếu tính năng |
| 1.3 | FR_05 | Trong lúc gọi, hiện **popup riêng của app** show tên KH/SĐT/thời gian đang diễn ra | Chưa có — chỉ có widget nổi của chính SDK Omicall (không phải UI tự làm) | 🟡 Thiếu tính năng |
| 1.4 | FR_06, FR_07 | Khi cuộc gọi kết thúc (actor hoặc khách tắt máy) → đóng popup cuộc gọi, hiện **popup đánh giá + nhập ghi chú** | Chưa có | 🟡 Thiếu tính năng |
| 1.5 | BR_09, BR_11, FR_03, FR_04 | Khi actor **xác nhận gọi** (không phải khi cuộc gọi kết thúc), hệ thống phải tăng "Lần gọi" +1 và cập nhật "Liên hệ cuối" **ngay lập tức**, không phụ thuộc kết quả cuộc gọi | `call_count`/`last_contacted_at` (trong `CustomerCallStatsModel`) hiện chỉ tăng khi **webhook CDR về** (`handleOmicallWebhook`, lần đầu thấy `transaction_id`) — có độ trễ, và **mất luôn nếu webhook lỗi/không tới** | 🔴 Sai lệch hành vi nghiệp vụ — cần thêm API mới gọi ngay lúc actor bấm xác nhận, tách khỏi luồng webhook |
| 1.6 | Mục `k`, ID 0015 | Icon xem chi tiết → điều hướng sang màn "Thông tin chi tiết khách hàng" | Chưa có icon/điều hướng này trong `CustomersToCallTab.jsx` | 🟡 Thiếu tính năng |
| 1.7 | Mục `a`, ID 0001 | Toggle dự án mặc định = **VNFITE** | `CustomersToCallTab.jsx`: `filters.appCode: "tikluy"` — mặc định **TIKLUY**, ngược với SRS | 🟢 Sai default, dễ sửa |
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
| 2.3 | (mục 0.2) | Ghi chú **cho phép sửa**, gọi `updateCallTransaction` | Chỉ hiển thị, chưa có UI/API sửa | 🔴 Còn mở — chờ PM chốt có làm không |
| 2.4 | BR_04 | Nút Play chỉ hiện khi **có file ghi âm VÀ thời lượng cuộc gọi > 0 giây** | Code chỉ check `recording_file_url` truthy, **chưa check thêm điều kiện thời lượng > 0** | 🟢 Thiếu điều kiện phụ, dễ sửa |
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

**Chưa build gì cả** — không có route/controller/model/UI nào cho màn danh sách quản lý đầu số
Hotline. Bản thân SRS phần này cũng có dấu hiệu **chưa viết xong** — 2 trang cuối tài liệu (28-29)
lặp lại nguyên văn template của mục 1 (Business Rule BR_01-BR_16 giống hệt CRM.04.1, mockup screen
cũng là ảnh màn "Danh sách khách hàng cần gọi") thay vì nội dung riêng cho Tổng đài. Cần xác nhận lại
với người viết SRS trước khi bắt tay build mục này — không đủ thông tin để tự suy luận đúng.

API liên quan đã có sẵn trong `omicallClient.ts` nhưng chưa dùng: không có — cần thêm mới
`internal_phone/list`, `hotline/search`, `hotline/by-phone`, `hotline/update` nếu triển khai.

---

## 4. Việc cần PM/dev chốt trước khi code tiếp

- [x] **Cước phí (0.1):** ✅ 03-09-2026 — đổi về làm tròn 3 chữ số thập phân theo SRS. Đã sửa.
- [ ] **Ghi chú (0.2):** có làm tính năng sửa note gọi thẳng Omicall (`updateCallTransaction`) ngay
      bây giờ không?
- [x] **Kiến trúc nguồn dữ liệu lịch sử cuộc gọi (mục 0):** ✅ 03-09-2026 — giữ nguyên webhook +
      `CallLogModel`, không đổi sang live-query. Deviation có chủ đích, ghi nhận trong mục 0.
- [ ] **Luồng popup xác nhận gọi + tăng Lần gọi ngay lúc xác nhận (1.2-1.5):** đây là gap lớn nhất ở
      CRM.04.1, cần thiết kế lại cả FE (popup) lẫn BE (API mới ghi nhận lượt gọi tại thời điểm xác
      nhận, tách khỏi luồng webhook).
- [ ] **Bộ giá trị Trạng thái theo app (1.8):** SRS chỉ mô tả rõ cho TIKLUY, "app khác" dùng KYC —
      cần hỏi lại VNFITE thuộc nhóm nào.
- [ ] **CRM.04.3 (Tổng đài):** SRS chưa viết xong, cần bổ sung trước khi build.

## 5. Đề xuất thứ tự ưu tiên (chưa làm, chờ PM duyệt)

1. Sửa nhanh, rủi ro thấp: 1.7 (default VNFITE), 2.4 (điều kiện thời lượng > 0 cho nút Play).
2. Bộ lọc "Trên 3 lần" (1.1) — độc lập, không đụng phần khác.
3. Luồng popup xác nhận gọi + ghi nhận lượt gọi ngay lúc xác nhận (1.2-1.5) — việc lớn nhất, ảnh
   hưởng UX chính của màn hình.
4. Icon xem chi tiết khách hàng (1.6) — cần màn "Thông tin chi tiết khách hàng" đã tồn tại chưa,
   kiểm tra trước khi làm.
5. Ghi chú sửa được (0.2) + cước phí làm tròn 3 số (0.1) — làm cùng lúc vì cùng đụng
   `CallHistoryTab.jsx`.
6. CRM.04.3 — chờ SRS viết xong.
