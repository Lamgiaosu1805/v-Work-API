# Module `ticket` — Ticket hỗ trợ nội bộ: Kế hoạch triển khai

> Trạng thái: **ĐÃ CHỐT THIẾT KẾ 23/10/2026 — chưa code.**
> Nguồn: 3 vòng phản biện với chủ hệ thống (23/10/2026) + khảo sát code vWork, VNFITE
> (`D:\VNFITE\vnfite_v2_microservice`) và TIKLUY (`D:\TIKLUY`).

Module mới, viết theo pattern DDD/Hexagonal của `src/modules/request` — xem `CLAUDE.md` mục "DDD + Hexagonal Architecture". Ticket **khác** đơn từ (`request`): đơn chỉ duyệt/từ chối, còn ticket có tiếp nhận, giao việc, trao đổi, cảnh báo và kết quả xử lý — nên tách module riêng, không mở rộng `request`.

## 0. Phạm vi đã chốt với chủ hệ thống

| Quyết định       | Nội dung                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ai tạo ticket    | **Mọi nhân viên** đều tạo được. Khách không tự tạo: khách báo lỗi qua fanpage/Sale/CSKH → Sale/CSKH vào vWork tạo ticket. Khách không đăng nhập vWork, không có bình luận công khai |
| Ai xem/nhận      | Ticket thường: **nhân viên thường chỉ xem ticket của mình và của người cùng phòng; người xử lý / quản lý xem hết** (đổi 30/10/2026, mục 6.1). **Chỉ người có quyền `ticket.handle` mới nhận và xử lý được** (role `WORKPLACE_TICKET_HANDLER` / `_STAFF` / `_MANAGER`, đổi 30/10/2026 — trước đó mọi nhân viên nhận được; xem mục 21) |
| Phân loại        | Tiêu đề tự do (bắt buộc) + nhãn **sản phẩm** + **loại yêu cầu** + **mẫu yêu cầu** (không bắt buộc). Tất cả là dữ liệu cấu hình, không hard-code                                     |
| SLA              | **Không dùng SLA/hạn chót cứng.** Thay bằng **cảnh báo vàng**: ticket bị bỏ quên được **bôi vàng trên giao diện cho mọi người thấy**, không gửi thông báo, trừ ticket Khẩn / Cao chưa ai nhận (nhắc người phụ trách 1 lần, mục 7.2) (mục 8) |
| Nhóm xử lý       | Ai trong nhóm (chủ trì + phối hợp) cũng đổi trạng thái, kết luận được. Chủ trì chỉ là đầu mối (mục 3.2)                                                                             |
| Tờ trình         | Giai đoạn này **chưa duyệt điện tử**: tờ trình gửi qua email, người tạo tải **file/ảnh tờ trình có chữ ký** lên ticket. Chừa sẵn đường cho duyệt điện tử (mục 5)                    |
| Thông báo        | Chỉ gửi **đúng người cần**, theo bảng quy tắc (mục 7). Không bản tin hằng ngày, không người theo dõi                                                                                |
| Tự đóng / mở lại | Đồng bộ **3 ngày làm việc** (mục 4.5)                                                                                                                                               |
| File CCCD        | **Không xoá**, không ghi log mở/tải. Chỉ giới hạn người xem (mục 6)                                                                                                                 |
| SĐT khách        | Hiện **đầy đủ** ngay trong danh sách                                                                                                                                                |
| Hoãn sang sau    | Đánh giá hài lòng, xuất Excel, duyệt tờ trình điện tử, app mobile (web trước)                                                                                                       |

## 1. Vai trò

| Vai trò                                        | Việc làm                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Người tạo (nhân viên; Sale/CSKH tạo cho khách) | Tạo, sửa, bổ sung, **xác nhận đã xong**, mở lại, **huỷ**                                     |
| Nhóm xử lý (chủ trì + phối hợp)                | Ai trong nhóm cũng: xử lý, trao đổi, đính kèm, đổi trạng thái, kết luận, thêm người phối hợp |
| Người chủ trì                                  | Thành viên đầu mối của nhóm: tên hiện ở danh sách, nhận thông báo thay cả nhóm               |
| Ban lãnh đạo                                   | Giao cho **phòng ban** hoặc **người cụ thể** (một hoặc nhiều)                                |
| Trưởng bộ phận                                 | Giao cho **người cụ thể** (một hoặc nhiều) **trong phòng mình** (kể cả phòng con)            |
| Quản trị cấu hình                              | Sản phẩm, loại, mẫu, người phụ trách, ngưỡng cảnh báo, thời gian tự đóng                     |

- **Xác nhận đã xong** ≠ **Huỷ**: xác nhận = đồng ý IT đã xử lý xong → đóng "Đã giải quyết". Huỷ = rút yêu
  cầu **trước khi** xử lý xong (tạo nhầm, khách tự làm được) → "Đã huỷ". Báo cáo tách riêng 2 số này.
- Trưởng phòng CSKH muốn đẩy việc sang IT thì **tạo ticket**, để IT tự nhận — không giao chéo phòng.

## 2. Phân loại

### 2.1 Bốn thông tin phân loại

- **Tiêu đề tự do, bắt buộc** — người tạo tự mô tả ngắn để IT nhìn là hiểu. Chọn mẫu thì tiêu đề được gợi ý
  sẵn (vd `[TIKLUY APP] Reset thiết bị – 0912345678`), vẫn sửa được.
- **Sản phẩm** (lỗi ở đâu) — danh mục cấu hình, có nhóm cha:

  | Sản phẩm               | Nhóm   | `app_code` (để tìm khách trong CRM) |
  | ---------------------- | ------ | ----------------------------------- |
  | VNFITE APP, VNFITE CMS | VNFITE | `vnfite`                            |
  | TIKLUY APP, TIKLUY CMS | TIKLUY | `tikluy`                            |
  | CRM, HRM, Workplace    | vWork  | —                                   |

- **Loại yêu cầu**: lỗi/sự cố, hỗ trợ tài khoản khách, giao dịch & lãi, thay đổi thông tin khách, quyền &
  tài khoản nội bộ, thiết bị & mạng, đề xuất tính năng, hỏi đáp, **khác**.
- **Mẫu yêu cầu** (không bắt buộc) — cho các ca hay gặp. Không có mẫu phù hợp → "Khác" và tự mô tả.

### 2.2 Mẫu yêu cầu ban đầu (seed)

Mỗi mẫu là **cấu hình**: trường bắt buộc, giấy tờ (đánh dấu nhạy cảm), có cần tờ trình, mức khẩn mặc
định, người phụ trách, hướng dẫn tự xử lý. Thêm mẫu mới không sửa code.

(Cột "Mức khẩn" là mức mặc định của mẫu: Cao = mã `high`. Mẫu tạo từ seed trước 27/10/2026 có thể còn mã `urgent`
= Khẩn trong DB — đổi ở Cấu hình → Mẫu yêu cầu.)

| Mẫu | Thông tin bắt buộc                                                                                                          | Giấy tờ                              | Tờ trình                   | Mức khẩn    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------- | ----------- |
| Quên mật khẩu / bị khoá đăng nhập      | SĐT khách, lý do khách không tự đặt lại được                                                                                | —                                    | Không                      | Cao        |
| Reset thiết bị                         | SĐT khách                                                                                                                   | **CCCD 2 mặt** (nhạy cảm)            | Không                      | Cao        |
| Không cộng lãi / sai lãi               | SĐT. TIKLUY: **mã khoản đầu tư (VNF + 13 số)**, sản phẩm, ngày & số tiền dự kiến. VNFITE: mã khoản vay, kỳ, số tiền dự kiến | Ảnh chụp màn hình                    | Không                      | Bình thường |
| Rút/nạp tiền bị treo                   | SĐT, số tiền, thời gian, ngân hàng, mã giao dịch (nếu có)                                                                   | Ảnh chuyển khoản (nhạy cảm)          | Không                      | Cao        |
| Mở khoá / làm lại eKYC                 | SĐT                                                                                                                         | —                                    | Không                      | Bình thường |
| **Đổi số điện thoại**                  | SĐT cũ, SĐT mới, số CCCD                                                                                                    | CCCD 2 mặt, bằng chứng chính chủ SIM | **Bắt buộc**               | Bình thường |
| **Tất toán trước hạn (ngoại lệ)**      | Mã khoản đầu tư, lý do ngoại lệ                                                                                             | —                                    | **Bắt buộc**               | Bình thường |
| **Tăng lãi / ngoại lệ về luồng, tiền** | Mã khoản đầu tư, lãi hiện tại → đề xuất, ngày hiệu lực, căn cứ (số QĐ)                                                      | —                                    | **Bắt buộc**               | Bình thường |
| Khác                                   | Tiêu đề, mô tả                                                                                                              | Tuỳ                                  | Người xử lý có thể yêu cầu | Bình thường |

### 2.3 Điều rút ra từ code VNFITE / TIKLUY (khảo sát 23/10/2026)

- **Gắn khách từ CRM**: `CustomerModel.external_id` chính là userId mà CMS dùng (TIKLUY: `tbl_user.ID`;
  VNFITE: `auth_db.users.id`) → ticket hiển thị luôn id để IT thao tác ngay. Sale không thấy khách trong
  phạm vi của mình thì vẫn nhập SĐT tự do.
- **Mã khoản đầu tư VNF + 13 số không có trong vWork** (`InvestmentModel.external_investment_id` là id nội
  bộ của TIKLUY, không phải mã khách thấy) → form phải hỏi. Đặt nhãn rõ để không nhầm với **số tài khoản
  VNF** (cũng bắt đầu bằng "VNF"). VNFITE chưa đồng bộ khoản đầu tư sang vWork.
- **Hướng dẫn tự xử lý trong mẫu** (giảm ticket): quên mật khẩu — cả 2 app cho khách tự đặt lại (SĐT + CCCD
  - OTP); reset thiết bị — VNFITE có tự làm, TIKLUY chưa; tất toán đủ 70% kỳ hạn — TIKLUY tự làm trên app.
    Chỉ tạo ticket khi khách không tự làm được.
- **Không có API đổi SĐT** ở cả 2 sản phẩm → IT sửa tay trong DB sản phẩm **và** sửa khách trong CRM vWork
  (`CustomerModel` unique theo app + SĐT).
- **CMS cả 2 sản phẩm không ghi ai đã reset mật khẩu/thiết bị/mở khoá** → ticket vWork là nơi duy nhất còn
  dấu vết. Khi kết luận có ô **"Kết quả thực hiện" không bắt buộc** (đã làm gì, trên hệ thống nào, cho khách hàng
  hoặc nhân viên nào) — có thì ghi, không có thì để trống.
- **Reset mật khẩu trên CMS trả mật khẩu mới dạng chữ thường cho IT** → **tuyệt đối không ghi mật khẩu vào
  ticket**. Hệ thống cảnh báo khi nội dung trao đổi trông giống mật khẩu; quy định kênh gửi mật khẩu cho
  khách nằm ngoài ticket.

## 3. Nhận việc, giao việc, chống nhận trùng

### 3.1 Hai cách nhận

| Tình huống                                              | Ai nhận được                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Không ai giao                                           | Người có `ticket.handle` bấm "Nhận xử lý" (từ 30/10/2026 quyền này **không** thuộc role nhân viên mặc định) |
| Ban lãnh đạo giao cho **phòng ban**                     | Thành viên phòng đó tự nhận (tab "Giao cho phòng tôi"), hoặc trưởng phòng chỉ định tiếp |
| Ban lãnh đạo / trưởng bộ phận giao cho **người cụ thể** | **Chỉ** những người được chỉ định                                                       |

### 3.2 Nhóm xử lý: chủ trì và phối hợp

- Nhóm xử lý = **1 người chủ trì** + không giới hạn người phối hợp.
- **Quyền như nhau**: ai trong nhóm cũng đổi trạng thái, yêu cầu bổ sung, tạm hoãn, xác nhận tờ trình, kết
  luận, đặt ngày hẹn, thêm người phối hợp.
- Chủ trì chỉ khác ở 2 điểm: là **đầu mối** (tên hiện ở danh sách) và **nhận thông báo thay cả nhóm** (người
  tạo bổ sung xong, sửa nội dung, tới ngày theo dõi) — để không báo trùng cho nhiều người.
- Tab "Tôi đang xử lý" tính cả ticket mình là chủ trì lẫn phối hợp.

### 3.3 Người phối hợp vào nhóm thế nào

| Cách                          | Diễn ra                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Được giao từ đầu**          | Sếp giao cho nhiều người: người giao chọn sẵn chủ trì, hoặc **người đầu tiên bấm "Nhận" thành chủ trì**; những người còn lại trong danh sách **tự động là phối hợp**, không cần bấm gì |
| **Người trong nhóm thêm vào** | Bất kỳ ai trong nhóm bấm "Thêm phối hợp" và chọn người (không giới hạn phòng ban — đây là mời phối hợp, không phải giao việc của sếp). Người được thêm nhận thông báo                  |
| **Người ngoài muốn tham gia** | **Không tự vào được** (giữ nguyên tắc chống nhận trùng). Nhắn/@nhắc tên trong phần trao đổi → người trong nhóm thêm vào                                                                |

- Rời nhóm: phối hợp tự bấm "Rời", hoặc người trong nhóm bỏ ra.
- Chủ trì bấm "Trả lại": còn phối hợp thì người được thêm sớm nhất thành chủ trì; không còn ai thì ticket về
  `open`.
- Người có quyền giao (sếp) đổi được chủ trì và thành viên nhóm bất kỳ lúc nào.

### 3.4 Chống hai người cùng nhận

- "Nhận xử lý" là thao tác **nguyên tử** (`findOneAndUpdate` có điều kiện chưa có chủ trì + đúng nhóm được
  giao). Người bấm sau nhận lỗi 409 "Nguyễn A đã nhận lúc 9:05" — muốn cùng làm thì xin vào nhóm (3.3).
- Danh sách luôn hiện chủ trì (+ số người phối hợp).
- Vì nhiều người trong nhóm cùng đổi trạng thái được, mọi lệnh ghi lên ticket dùng **optimistic
  concurrency** (trường `version`): người thao tác sau trên dữ liệu cũ nhận thông báo "Ticket vừa được
  Nguyễn A cập nhật, tải lại để xem" thay vì ghi đè.

### 3.5 Trùng vs Liên quan

- **"Trùng"** (kết quả đóng) chỉ dùng khi **cùng khách và cùng sự việc** (vd 2 Sale cùng tạo cho 1 khách).
  Bắt buộc ghi ticket gốc. Khác khách → hệ thống cảnh báo trước khi cho đánh "Trùng".
- **"Liên quan đến TK-…"**: liên kết các ticket cùng nguyên nhân (cùng 1 lỗi app nhưng nhiều khách) — **mỗi
  ticket vẫn xử lý và đóng riêng**, không tự đóng theo nhau.
- Ticket lỗi code có trường tuỳ chọn "liên kết branch/PR" để dev biết đã có người sửa.

## 4. Trạng thái và kết quả

### 4.1 Trạng thái

| Trạng thái                   | Ý nghĩa                                                                                                      | Đang chờ ai          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| `open` — Mới                 | Chưa có chủ trì (có thể đã giao cho phòng/nhóm người)                                                        | IT / người được giao |
| `in_progress` — Đang xử lý   | Đã có chủ trì                                                                                                | Nhóm xử lý           |
| `waiting_info` — Chờ bổ sung | Trả về người tạo: thiếu thông tin, giấy tờ, tờ trình                                                         | Người tạo            |
| `on_hold` — Tạm hoãn         | Chờ bên khác (dev release, ngân hàng, đối tác). **Bắt buộc lý do**, ngày dự kiến tiếp tục **không bắt buộc** | Bên thứ ba           |
| `resolved` — Đã xử lý        | Chờ người tạo xác nhận                                                                                       | Người tạo            |
| `closed` — Đã đóng           | Kèm kết quả                                                                                                  | —                    |
| `cancelled` — Đã huỷ         | Người tạo rút yêu cầu                                                                                        | —                    |

### 4.2 Kết quả khi đóng

| Kết quả                 | Ý nghĩa                                           |
| ----------------------- | ------------------------------------------------- |
| Đã giải quyết           | Bình thường                                       |
| Không giải quyết        | Bắt buộc ghi lý do                                |
| Chưa đủ cơ sở           | Đã xem xét, không đủ căn cứ để thực hiện          |
| Không phải lỗi          | Hệ thống chạy đúng nghiệp vụ                      |
| Trùng                   | Chỉ khi cùng khách + cùng sự việc, kèm ticket gốc |
| Người tạo không bổ sung | Hệ thống tự đóng từ `waiting_info`                |

Không có "Giải quyết tạm". Thay bằng dấu **"Cần theo dõi thêm"** khi báo đã xử lý (mục 4.4).

### 4.3 Luồng

```
Tạo ─► open ──nhận/giao──► in_progress ──xử lý xong──► resolved ──xác nhận / tự đóng──► closed
            │                 │  ▲  ├──► on_hold ──tiếp tục──┘
            │                 │  │  └──kết luận không làm / chưa đủ cơ sở / không phải lỗi──► closed
            │                 ▼  │
            │            waiting_info ──quá hạn không bổ sung──► closed (người tạo không bổ sung)
            └──► cancelled (người tạo huỷ khi open hoặc waiting_info)
in_progress ──trả lại──► open
resolved ──người tạo thấy chưa ổn──► in_progress (mở lại)
closed (không phải do người tạo xác nhận) ──mở lại trong 3 ngày làm việc──► in_progress
```

**Ghi chú khi đổi trạng thái**: mọi lần đổi đều ghi chú được (không bắt buộc) và hiện trên lịch sử — vd khi
báo đã xử lý thì ghi đã làm gì, có vấn đề gì phát sinh. **Chỉ bắt buộc** khi thiếu ghi chú sẽ không hiểu
được: chờ bổ sung (thiếu gì — qua checklist 4.4), tạm hoãn (lý do), đóng với kết quả khác "Đã giải quyết"
(lý do), huỷ, mở lại, trả lại, và đổi mức khẩn **do nhóm xử lý** (người tạo tự đổi mức khẩn thì lý do không bắt buộc).

### 4.4 Yêu cầu bổ sung và "Cần theo dõi thêm"

Người trong nhóm xử lý chọn mục còn thiếu theo checklist (+ ghi thêm cho từng mục):

| Nhóm       | Mục                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chung      | Mô tả rõ hơn, ảnh/video lỗi, các bước tái hiện                                                                                             |
| Khách hàng | SĐT, mã khách, số CCCD; CCCD 2 mặt; xác nhận của khách (tin nhắn/ghi âm đồng ý)                                                            |
| Tài chính  | Mã khoản đầu tư/khoản vay; chứng từ (sao kê, UNC, ảnh chuyển khoản, mã giao dịch); số tiền & thời điểm; căn cứ áp dụng (số QĐ, chính sách) |
| Phê duyệt  | Tờ trình có chữ ký; tờ trình thiếu chữ ký / sai nội dung                                                                                   |
| Khác       | Ghi rõ                                                                                                                                     |

Người tạo nhận thông báo → tải bổ sung → bấm "Đã bổ sung" → ticket tự về `in_progress`, báo chủ trì.

**Cần theo dõi thêm**: khi báo đã xử lý, người trong nhóm có thể đánh dấu + ghi cần theo dõi gì + ngày kiểm tra
(không bắt buộc). Kết quả vẫn là "Đã giải quyết". Ticket **không tự đóng trước ngày kiểm tra**; tới ngày
đó chủ trì được nhắc 1 lần để xác nhận rồi đóng.

### 4.5 Tự đóng và mở lại — đồng bộ 3 ngày làm việc

| Quy tắc                                                          | Giá trị (cấu hình được)                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `resolved` không xác nhận → tự đóng "Đã giải quyết"              | **3 ngày làm việc** (giờ làm việc, mục 8.4)                         |
| `waiting_info` không bổ sung → tự đóng "Người tạo không bổ sung" | **3 ngày làm việc**, nhắc người tạo 1 lần trước 1 ngày              |
| Mở lại sau khi đóng                                              | Trong **3 ngày làm việc** kể từ lúc đóng                            |
| Người tạo **đã bấm xác nhận** đã xong                            | **Không mở lại được nữa**                                           |
| Quá hạn mở lại                                                   | Bắt buộc tạo ticket mới — có nút **"Tạo ticket mới từ ticket này"** |

"Tạo ticket mới từ ticket này": chép sản phẩm, loại, mẫu, khách, mô tả, tự gắn "Liên quan đến TK-…".
**Không** chép file nhạy cảm — người tạo đính kèm lại.

## 5. Tờ trình

### 5.1 Giai đoạn này (`mode = document`)

- Cần tờ trình khi: mẫu bắt buộc (đổi SĐT, tất toán ngoại lệ, tăng lãi, ngoại lệ luồng/tiền) **hoặc** người
  trong nhóm xử lý thấy chưa đủ cơ sở và bật "Cần tờ trình" → ticket chuyển `waiting_info` với mục "Tờ trình" **và chuyển
  sang ticket hạn chế** (mục 6) từ lúc đó.
- Người tạo tải ảnh/PDF tờ trình đã ký (lấy từ email) + số tờ trình, ngày, người ký.
- Người trong nhóm xử lý hoặc người có quyền xem ticket hạn chế bấm **"Tờ trình hợp lệ"** / **"Không hợp lệ"** (kèm lý do
  → trả về người tạo).
- **Chưa xác nhận tờ trình hợp lệ thì không được kết luận "Đã giải quyết".** Tờ trình đã xác nhận không xoá
  được, chỉ thêm.

### 5.2 Chừa đường cho duyệt điện tử

- Phần phê duyệt là khối riêng trong ticket, có trường `mode`. Hiện `mode = "document"`, trạng thái:
  `missing → submitted → verified | invalid`.
- Sau này thêm `mode = "electronic"`: các cấp duyệt, hàng chờ duyệt của sếp, trạng thái ticket
  `pending_approval`; dùng lại chuỗi duyệt của đơn từ
  (`core/authorization/resolve-request-approval-candidates.ts`).
- Trong domain, mỗi mode là 1 "cổng duyệt" (`ApprovalGate`) trả lời đúng 1 câu: _đã đủ điều kiện thực hiện
  chưa?_ Ticket cũ giữ `mode = "document"` và vẫn hợp lệ.
- **Mọi chỗ chừa cho duyệt điện tử trong code gắn cùng 1 nhãn để grep được**:

  ```ts
  // [CHỜ-DUYỆT-ĐIỆN-TỬ] Hiện chỉ có mode "document" (tải file tờ trình từ email).
  // Khi làm duyệt trên vWork: thêm ElectronicApprovalGate + status "pending_approval",
  // xem docs/TICKET-MODULE-PLAN.md mục 5.2.
  ```

  Danh sách các điểm chờ được cập nhật ở mục 12 khi code.

## 6. Quyền xem và dữ liệu nhạy cảm

### 6.1 Ai xem được gì

|                                                                      | Ticket thường | Ticket hạn chế (cần tờ trình / đánh dấu hạn chế)           | File nhạy cảm (CCCD, chứng từ, tờ trình) |
| -------------------------------------------------------------------- | ------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Nhân viên thường (chỉ có quyền mặc định)                             | ✔ nếu do **mình hoặc người cùng phòng** tạo; ticket phòng khác ✘ | ✘ (không thấy trong danh sách)                             | ✘ — chỉ thấy dòng thông tin file (6.2)   |
| Người có `ticket.handle`, giao phòng ban, quản lý (xem mọi ticket thường) | ✔ mọi ticket  | chỉ khi liên quan (như dưới)                               | chỉ khi liên quan (như dưới)             |
| Ban lãnh đạo, trưởng IT, IT (quyền xem ticket hạn chế / file nhạy cảm) | ✔             | ✔ luôn                                                     | ✔ luôn                                   |
| Người tạo                                                            | ✔             | ✔ khi chưa đóng; **sau khi đóng chỉ thấy thông tin chung** | ✔ khi chưa đóng; ✘ sau khi đóng          |
| Nhóm xử lý: chủ trì, phối hợp (kể cả ngoài IT, vd Kế toán được giao) | ✔             | ✔ khi chưa đóng                                            | ✔ khi chưa đóng; ✘ sau khi đóng          |

- **"Cùng phòng"** = mọi nhân viên thuộc phòng của người xem, kể cả phòng con và phòng họ làm trưởng (tra lúc xem,
  không lưu vào ticket nên điều chuyển nhân sự có hiệu lực ngay). Người được giao / phối hợp thì thấy ticket dù khác
  phòng; thành viên phòng được giao thấy ticket đang chờ phòng nhận. Ticket thường đã đóng vẫn xem đủ với người
  cùng phòng. Trưởng bộ phận (chỉ có `assign_member`) không xem được ticket chưa giao của phòng khác. Code:
  `canViewAll` / `colleagueIds` ở `TicketActor`, `accessLevel` (`ticket-access.ts`), `visibilityFilter`
  (`ticket-query-filters.ts`). `canViewAll` = có một trong `ticket.handle`, `assign_department`, `manage`,
  `view_restricted`, `view_sensitive`.
- **Thông tin chung** người tạo vẫn thấy sau khi đóng ticket hạn chế: mã, tiêu đề, trạng thái, kết quả, ghi
  chú kết luận — đủ để biết kết quả và mở lại trong 3 ngày. Không thấy file, tờ trình, phần trao đổi.
- SĐT khách hiện đầy đủ.

### 6.2 Hiển thị file khi không còn quyền xem

Không ẩn hẳn — hiện **dòng thông tin** để người dùng biết file vẫn còn, chỉ là họ không xem được:

> 🔒 Tờ trình (1 file) · tải lên bởi Nguyễn B lúc 10:20 21/10/2026 · đã xác nhận hợp lệ ·
> _Bạn không còn quyền xem file này. Liên hệ IT nếu cần._

Chỉ hiện **loại giấy tờ** (do mẫu/checklist đặt), người tải, thời gian, trạng thái — **không** hiện tên file
gốc (tên file có thể chứa thông tin cá nhân).

### 6.3 Lưu trữ và kiểm soát

- File CCCD/chứng từ **không xoá**, **không ghi log** mở/tải — chỉ kiểm soát bằng quyền xem (6.1).
- File lưu thư mục riêng tư — mặc định `UPLOAD_DIR_{DEV,PROD}/ticket` (dùng chung volume upload đã mount), đổi
  được bằng `TICKET_DIR_{DEV,PROD}` (không qua `/static`), lọc loại file, giới hạn dung lượng, kiểm tra quyền rồi
  mới cấp URL có ký (`helpers/fileSignature.js`). `GET /document/getFile` (phục vụ `UPLOAD_DIR_PROD`) chặn thư
  mục ticket và `../`, nên file ticket chỉ tải được qua `/tickets`.

## 7. Thông báo

### 7.1 Người phụ trách

Báo cho đúng người khi có ticket mới sẵn sàng để nhận (đổi lại 26/10/2026 — trước đây chỉ ticket mức Cao và "cấp cụ thể
thay mặc định"). **Cộng dồn**:

- Người của **mẫu yêu cầu** + **loại yêu cầu** + **sản phẩm** cùng nhận thông báo, **mọi mức khẩn**.
- Ticket **Khẩn** và **Cao** nhận thêm danh sách **mặc định** (cài đặt chung); ticket Bình thường / Thấp thì không báo danh sách mặc định.
- Ticket **chưa ai nhận** (`open`, chưa có chủ trì) được **nâng lên Khẩn hoặc Cao** sau khi tạo → báo lại đúng nhóm trên
  ("Ticket được nâng lên mức …"). Hạ mức, nâng lên mức thường, hoặc ticket đã có chủ trì thì không báo.
- Trùng người ở nhiều cấp chỉ báo một lần; người tạo ticket không tự nhận thông báo của mình.
- Ticket đang chờ người tạo bổ sung tờ trình (`waiting_info`) chưa báo; khi người tạo bổ sung xong mà ticket chưa có
  chủ trì thì mới báo người phụ trách ("Ticket đã đủ thông tin, chờ nhận").
- Người phụ trách chỉ **nhận thông báo**, không độc quyền nhận ticket (ai có `ticket.handle` vẫn nhận được).
- Cấu hình: màn Cấu hình → Cài đặt chung → "Người phụ trách nhận thông báo" (cũng sửa được ở tab Sản phẩm, Loại yêu cầu,
  Mẫu yêu cầu). Code: `application/ticket-responsible.ts`.

### 7.2 Bảng quy tắc

Toàn bộ là thông báo một-một. Người tự thực hiện hành động không nhận thông báo của chính mình. Gửi qua
`services/notificationService.js` (socket + FCM). Bảng này là cấu hình trong **1 file chính sách** duy nhất
(`application/ticket-notification.policy.ts`: sự kiện → cách tìm người nhận).

| Sự kiện                                                         | Người nhận                          |
| --------------------------------------------------------------- | ----------------------------------- |
| Tạo ticket (mọi mức khẩn)                                       | Người phụ trách (7.1)               |
| Ticket chưa ai nhận được nâng lên Khẩn / Cao                    | Người phụ trách (7.1)               |
| Giao đích danh (1 hoặc nhiều người)                             | Tất cả những người được giao        |
| Giao cho phòng ban                                              | Trưởng phòng; phòng chưa có người quản lý và ticket chưa ai nhận → cả phòng (kể cả phòng con); ticket đã có người nhận → thêm chủ trì + người phối hợp |
| Giao lại (đổi nhóm xử lý)                                       | Người cũ bị gỡ ra khỏi nhóm xử lý    |
| Mọi lần giao việc                                               | Người tạo ("đã được giao cho …")    |
| Có người nhận xử lý                                             | Người tạo                           |
| Yêu cầu bổ sung / thiếu tờ trình / tờ trình không hợp lệ        | Người tạo                           |
| Người tạo bổ sung xong (chưa có chủ trì → người phụ trách)       | Chủ trì + người phối hợp            |
| Người tạo sửa nội dung sau khi đã có chủ trì                     | Chủ trì                             |
| Đã xử lý / đã đóng / bị đóng do trùng, chưa đủ cơ sở…           | Người tạo                           |
| Tạm hoãn · Tiếp tục xử lý · Quay về hàng chờ nhận (chủ trì trả lại, không còn ai) | Người tạo (thêm 30/10/2026) |
| Ticket **Khẩn / Cao chưa ai nhận** đã quá ngưỡng cảnh báo (bị bôi vàng) | Người phụ trách (7.1), **đúng 1 lần cho mỗi mốc vàng** (cron, thêm 30/10/2026) |
| Nhắc trước khi tự đóng `waiting_info`                           | Người tạo                           |
| Được thêm vào nhóm phối hợp                                     | Người được thêm                     |
| Tới ngày kiểm tra "Cần theo dõi thêm"                           | Chủ trì                             |
| @nhắc tên trong trao đổi                                        | Người được nhắc ("Bạn được nhắc tên trong ticket …") |
| Có tin nhắn mới trong trao đổi                                  | Người tạo + chủ trì + người phối hợp; ticket chưa có chủ trì → người được giao đích danh / trưởng phòng được giao + người phụ trách (7.1). Người được nhắc tên chỉ nhận thông báo nhắc tên. |

**Cảnh báo vàng không gửi thông báo** — chỉ bôi vàng trên giao diện (mục 8). **Ngoại lệ duy nhất (30/10/2026):** ticket **Khẩn / Cao chưa ai nhận** khi bị bôi vàng sẽ nhắc người phụ trách 1 lần (cron `ticketSweepJob`, đánh dấu bằng `alert_notified_for`); ticket Bình thường / Thấp vẫn chỉ bôi vàng. Nếu ticket vừa được nâng lên Khẩn / Cao mà mốc vàng đã qua thì người phụ trách có thể nhận cả thông báo "nâng mức" lẫn thông báo nhắc.

**Tin nhắn trong trao đổi** (thêm 27/10/2026): người gửi không tự nhận; mỗi người chỉ nhận một thông báo cho mỗi tin
(nhắc tên đứng trước thông báo chung). Ticket chưa có chủ trì mà đang chờ người tạo bổ sung (`waiting_info`) chưa báo
người phụ trách. Ticket hạn chế: thông báo không kèm nội dung tin nhắn. Người từng nhắn trước đó nhưng không thuộc nhóm
xử lý (vd người được nhắc tên vào tham gia) không tự nhận thông báo các tin sau, trừ khi được nhắc tên tiếp. Code:
`planMessageNotifications` trong `application/ticket-notification.policy.ts`. Danh sách tin nhắn trên giao diện cao tối
đa 500px, cuộn bên trong và tự cuộn tới tin mới nhất; Enter gửi, Shift + Enter xuống dòng.

Reset mật khẩu / reset thiết bị được báo ngay **nhờ mức khẩn mặc định của mẫu**, không có code đặc cách
theo loại. Ca nào sau này cần báo ngay chỉ cần đặt mẫu đó là Khẩn hoặc Cao.

## 8. Cảnh báo vàng (thay cho SLA)

### 8.1 Nguyên tắc

Không đo nhanh hay chậm (mỗi người có việc chính; nhiều việc phụ thuộc bên khác; thời gian xử lý chênh rất
xa). Đo **ticket có đang bị bỏ quên không**. Một ticket cũ nhưng vẫn có cập nhật là bình thường; ticket mới
mà không ai đụng tới mới đáng lo.

### 8.2 Bốn tín hiệu

| Tín hiệu                  | Thành vàng khi                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------- |
| 1. Chưa ai nhận           | `open` quá ngưỡng A                                                                    |
| 2. Im lặng                | `in_progress` không có hoạt động nào (trao đổi, đổi trạng thái, cập nhật) quá ngưỡng B |
| 3. Quá ngày hẹn           | Quá **ngày dự kiến do chính nhóm xử lý tự đặt** (không bắt buộc)                       |
| 4. Tạm hoãn chưa xác định | `on_hold` không có ngày dự kiến tiếp tục, không cập nhật quá ngưỡng C                  |

- **Ngày hẹn**: người trong nhóm xử lý tự ghi "dự kiến xong 30/10" khi nhận việc lớn → trước ngày đó không vàng vì im lặng.
  Dời ngày phải ghi lý do; số lần dời hiện trên ticket.
- `on_hold` **có** ngày dự kiến: không cảnh báo tới ngày đó. **Không** có ngày: tín hiệu 4 — chỉ cần ghi 1
  dòng cập nhật (vd "vẫn chờ ngân hàng phản hồi") là hết vàng.
- **Không tính** khi `waiting_info` / `resolved` (đang chờ người tạo — đã có tự đóng riêng).
- Có hoạt động mới → hết vàng.

### 8.3 Ngưỡng mặc định (cấu hình được trong Cài đặt chung, theo từng mức khẩn)

> Mức khẩn gồm 4 mức: **Khẩn** (mã `urgent`), **Cao** (mã `high`, thêm 27/10/2026), **Bình thường**, **Thấp**.
> Mỗi mức có một mốc xử lý tham khảo (ngày làm việc) và được quy đổi thành ngưỡng cảnh báo. Mốc xử lý KHÔNG phải
> hạn cứng — ticket chỉ vàng khi bị bỏ quên (8.1), không vàng chỉ vì quá số ngày của mức.

| Mức khẩn    | Mốc xử lý tham khảo | A: chưa ai nhận | B: im lặng      | C: tạm hoãn chưa xác định |
| ----------- | ------------------- | --------------- | --------------- | ------------------------- |
| Khẩn        | 1 ngày làm việc     | 6 giờ làm việc  | 1 ngày làm việc  | 5 ngày làm việc           |
| Cao         | 1–2 ngày làm việc   | 1 ngày làm việc | 2 ngày làm việc  | 5 ngày làm việc           |
| Bình thường | 2–5 ngày làm việc   | 2 ngày làm việc | 5 ngày làm việc  | 5 ngày làm việc           |
| Thấp        | 5–10 ngày làm việc  | 5 ngày làm việc | 10 ngày làm việc | 5 ngày làm việc           |

- Ngưỡng nhập theo **giờ hoặc ngày làm việc** trên màn Cấu hình (lưu bằng phút làm việc). Mức càng gấp ngưỡng càng
  ngắn: **Khẩn ≤ Cao ≤ Bình thường ≤ Thấp** — hệ thống từ chối lưu nếu sai thứ tự.
- Không có ghi đè ngưỡng theo mẫu: muốn mẫu nào theo dõi sát hơn thì đặt mức khẩn mặc định của mẫu cao hơn.
- Mẫu đặt mức mặc định, người tạo đổi được, nhóm xử lý điều chỉnh được (kèm ghi chú). Người tạo đổi mức không bắt
  buộc ghi lý do; nhóm xử lý đổi mức bắt buộc ghi lý do.
- Ticket **chưa ai nhận** bị nâng lên Khẩn / Cao → báo lại người phụ trách (gồm danh sách mặc định), xem 7.1.
- **Giá trị seed cho cài đặt tạo mới (30/10/2026)**, theo tài liệu "Hướng dẫn gửi ticket hỗ trợ trên CRM": ngưỡng A (chưa ai nhận) = thời hạn phản hồi đầu tiên — Khẩn **30 phút**, Cao **1 giờ**, Bình thường **4 giờ**, Thấp **1 ngày** (đơn vị phút làm việc). Cài đặt đã có trong DB **không bị ghi đè** — chỉnh ở màn Cấu hình → Cài đặt chung. Mốc "xử lý xong" của tài liệu (Khẩn 2 giờ … Thấp 3 ngày) không phải hạn cứng: chỉ là mốc tham khảo, ticket vẫn chỉ vàng khi bị bỏ quên (8.1).
- Khi chuyển vàng: ticket được **bôi vàng trên giao diện cho mọi người thấy** (danh sách + chi tiết, kèm lý
  do, vd "Chưa ai nhận 1 ngày làm việc") + tab "Cần chú ý" (tên cũ: "Cảnh báo vàng"). **Không gửi thông báo.**

### 8.4 Lịch làm việc

- **T2–T6 theo ca hành chính, T7 chỉ buổi sáng (ca sáng)**; nghỉ chiều T7, CN và ngày lễ trong
- **Seed cài đặt tạo mới (30/10/2026):** làm việc **T2–T6, không làm thứ 7**, 1 ngày làm việc = **480 phút** (8 giờ); khung giờ vẫn là 1 khoảng liền 08:00–17:00 nên giờ nghỉ trưa chưa được trừ (lịch chưa hỗ trợ nhiều khung giờ/ngày). Cài đặt đã có vẫn giữ T7 sáng + 540 phút cho tới khi sửa ở màn Cấu hình.
  `HolidayModel` (`scope_type = "all"`). Khớp với chấm công hiện tại (`jobs/genWorkSheet.js` gán ca sáng cho
  T7; `helpers/payrollPeriod.js` tính T7 = 0,5 công).
- Khung giờ từng thứ lưu trong cấu hình ticket (mặc định T2–T6 08:00–17:00, T7 08:00–12:00), không hard-code.
- "N ngày làm việc" = cộng dồn N × độ dài ca hành chính trên lịch này. Ví dụ báo xong 16:00 T6, tự đóng sau
  3 ngày làm việc: tính 1 giờ T6 + sáng T7 + cả T2 + cả T3 + phần còn lại sang T4.
- Ticket mức Khẩn / Cao tạo tối T6 vẫn báo người phụ trách ngay, nhưng chỉ thành vàng tính từ đầu giờ làm việc kế tiếp.
- **Kỹ thuật**: mở rộng `modules/customer-care/domain/working-calendar.ts` để mỗi thứ có khung giờ riêng, rồi
  **chuyển sang `src/shared-kernel/working-calendar.ts`** để 2 module dùng chung. Customer-care giữ cấu hình
  T2–T6 của mình (Quy định 183A), không bị ảnh hưởng.

### 8.5 Chỉ số

- **Tỉ lệ xử lý kịp** = ticket xử lý xong mà chưa từng bị vàng / tổng ticket xử lý xong.
- Tham khảo (không phải chỉ tiêu): thời gian chờ nhận trung bình, theo sản phẩm / theo mẫu — để thấy sản
  phẩm nào lỗi nhiều mà sửa tận gốc.

## 9. Màn hình (web trước, app sau)

- **Danh sách nhóm theo ngày** (Hôm nay, Hôm qua, 21/10…), mới nhất ở trên (riêng tab _Cần chú ý_ sắp theo mức
  bị bỏ quên lâu nhất, không nhóm ngày). 6 tab, một số tab có chip (tab con) — xem mục 16. Lọc: sản phẩm, loại,
  mẫu, mức khẩn, trạng thái, khoảng ngày, từ khoá.
- **Chi tiết ticket**: thông tin + trường theo mẫu, khách (kèm `external_id`), người tạo/chủ trì/phối hợp,
  checklist bổ sung, tờ trình, file, trao đổi (@nhắc tên, đính kèm), lịch sử.
- **Sửa ticket**: người tạo sửa tiêu đề, mô tả, sản phẩm, loại, khách, mức khẩn tới khi `resolved`; nhóm
  xử lý và người có quyền sửa phân loại, mức khẩn. Mọi lần sửa lưu cũ → mới. Ticket đã đóng khoá sửa.
- **Cấu hình**: sản phẩm, loại, mẫu (trường động, giấy tờ, tờ trình, mức khẩn, người phụ trách, hướng dẫn),
  ngưỡng cảnh báo, lịch làm việc, thời gian tự đóng/mở lại.

## 10. Thiết kế kỹ thuật

### 10.1 Cấu trúc

```
src/modules/ticket/
  domain/
    ticket.entity.ts              # AggregateRoot: máy trạng thái 4.3, chủ trì/phối hợp, quy tắc đóng/mở lại
    approval-gate.ts              # ApprovalGate + DocumentApprovalGate  [CHỜ-DUYỆT-ĐIỆN-TỬ]
    ticket-alert.ts               # tính alert_at / auto_close_at từ trạng thái + WorkingCalendar
    ticket-access.ts              # quy tắc mục 6.1 (thuần, không đọc DB)
    ticket.errors.ts, types.ts, events/
  infrastructure/
    ticket.repository.ts, ticket.mapper.ts, ticket-config.repository.ts
  application/
    create-ticket.service.ts, claim-ticket.service.ts, assign-ticket.service.ts,
    manage-collaborators.service.ts, transition-ticket.service.ts,
    request-info.service.ts, verify-approval.service.ts, add-message.service.ts, upload-attachment.service.ts,
    get-ticket(s).service.ts, ticket-config.service.ts,
    ticket-notification.policy.ts, ticket-notification.handlers.ts
  interface/
    ticket.http.controller.ts, ticket.routes.ts, ticket-config.routes.ts
  index.ts
src/shared-kernel/working-calendar.ts   # chuyển từ customer-care, thêm khung giờ theo thứ
src/workflows/create-ticket.workflow.ts # tra khách CRM (snapshot app_code, SĐT, tên, external_id) rồi gọi module ticket
src/jobs/ticketSweepJob.js              # cảnh báo vàng, tự đóng, nhắc
```

- Người dùng tham chiếu bằng `user_info._id` (`EmployeeId`) như module `request`; resolve account khi cần
  gửi thông báo.
- Kiểm tra "trưởng bộ phận chỉ giao trong phòng mình (kể cả phòng con)" dùng lại logic duyệt cây phòng ban ở
  `core/authorization` (BFS phòng ban của `resolve-managed-request-employee-ids.ts`).

### 10.2 Collection

| Collection                                             | Nội dung chính                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticket`                                               | `code` (unique, `TK-2610-0001`), `title`, `description`, `product_id`, `category_id`, `template_id`, `custom_fields`, `urgency`, `customer` (snapshot: `customer_id`, `app_code`, `phone`, `name`, `external_id`), `created_by`, `assignment` (`mode` none/department/members, `department_id`, `member_ids`, `assigned_by`, `owner_id`, `collaborator_ids`, `claimed_at`), `status`, `resolution` (`code`, `note`, `action_taken` không bắt buộc, `by`, `at`), `follow_up` (`note`, `check_at`), `hold` (`reason`, `resume_at` nullable), `info_request` (checklist), `approval` (`required`, `source`, `mode`, `status`, `reference`, `verified_by`, `verified_at`), `visibility`, `related_ticket_ids`, `duplicate_of`, `due_hint_at`, `reschedule_count`, `last_activity_at`, `alert_at`, `alert_reason`, `auto_close_at`, `confirmed_by_requester`, `closed_at`, `reopen_until`, `reopen_count`, `version` |
| `ticket_message`                                       | `ticket_id`, `author_id`, `body`, `mentions`, `attachment_ids`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ticket_attachment`                                    | `ticket_id`, `message_id`, `kind` (loại giấy tờ), `sensitive`, `original_name`, `stored_name`, `mime`, `size`, `uploaded_by`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ticket_activity`                                      | Lịch sử **chỉ ghi thêm**: `ticket_id`, `actor_id`, `action`, `from`/`to`, `changes` (cũ → mới), `note`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ticket_product`, `ticket_category`, `ticket_template` | Cấu hình mục 2 (mẫu: `fields` động, `required_documents`, `requires_approval`, `default_urgency`, `handler_ids`, `guidance`, `title_pattern`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ticket_setting`                                       | 1 document: người phụ trách mặc định, ngưỡng 8.3, lịch 8.4, thời gian tự đóng/mở lại 4.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ticket_counter`                                       | Sinh `code` theo tháng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Index chính: `{status, createdAt}`, `{"assignment.owner_id", status}`, `{"assignment.department_id", status}`,
`{"assignment.member_ids", status}`, `{created_by, createdAt}`, `{alert_at}`, `{auto_close_at}`,
`{"customer.phone"}`, `{code}` unique.

### 10.3 Quyền (thêm vào `scripts/seedPermissionCatalog.ts`, entity `Ticket`)

| Code                                                             | Cấp cho (seed ban đầu)                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `ticket.create`, `ticket.view`                                   | Mọi nhân viên (role baseline)                              |
| `ticket.handle` (nhận / xử lý)                                   | **Chỉ** 3 role: `WORKPLACE_TICKET_HANDLER` (người của đơn vị khác được giao việc — chỉ có quyền này), `WORKPLACE_TICKET_STAFF` (IT), `WORKPLACE_TICKET_MANAGER` |
| `ticket.assign_department`                                       | Ban lãnh đạo + role `WORKPLACE_TICKET_STAFF` (IT chuyển việc nghiệp vụ về phòng chủ trì) |
| `ticket.assign_member`                                           | Trưởng bộ phận (chỉ người trong phòng mình) + ban lãnh đạo |
| `ticket.view_restricted`, `ticket.view_sensitive`                | Ban lãnh đạo, trưởng IT, IT (`WORKPLACE_TICKET_STAFF`)     |
| `ticket.manage` (đổi chủ trì, đóng hộ, sửa phân loại mọi ticket) | Ban lãnh đạo, trưởng IT. Route `hold` / `resume` / `resolve` / `close` / `due-hint` / `links` / `request-info` / `collaborators` nhận **`ticket.handle` HOẶC `ticket.manage`** (đóng hộ không cần `handle`); `claim` và `release` vẫn chỉ `ticket.handle` |
| `ticket.config`                                                  | Admin, trưởng IT                                           |

Quyền theo vai trò trên ticket (người tạo, chủ trì, phối hợp, người được giao) do domain tính
(`ticket-access.ts`), không phải permission.

### 10.4 Endpoint `/tickets`

```
GET    /tickets                       # tab + bộ lọc mục 9, phân trang theo createdAt
POST   /tickets                       # qua workflows/create-ticket.workflow.ts
GET    /tickets/:id
PATCH  /tickets/:id                   # sửa nội dung (lưu cũ → mới)
POST   /tickets/:id/claim             # nhận (nguyên tử)
POST   /tickets/:id/release           # trả lại
POST   /tickets/:id/assign            # giao phòng / người, chọn chủ trì
POST   /tickets/:id/collaborators     # thêm phối hợp (người trong nhóm xử lý)
DELETE /tickets/:id/collaborators/:employeeId   # bỏ ra / tự rời
POST   /tickets/:id/request-info      # chờ bổ sung + checklist
POST   /tickets/:id/submit-info       # người tạo đã bổ sung
POST   /tickets/:id/hold | /resume
POST   /tickets/:id/resolve           # + "cần theo dõi thêm"
POST   /tickets/:id/confirm           # người tạo xác nhận → đóng, khoá mở lại
POST   /tickets/:id/close | /cancel | /reopen
POST   /tickets/:id/approval/verify
POST   /tickets/:id/links             # liên quan / trùng
POST   /tickets/:id/messages         # trao đổi (kèm file, @nhắc tên)
GET    /tickets/:id/attachments/:attId/download   # kiểm tra quyền → tải file
# Tin nhắn, file, lịch sử nằm trong GET /tickets/:id; "tạo ticket mới từ ticket này" làm ở web (POST /tickets + liên kết).
/tickets/config/products | categories | templates | settings   # CRUD cấu hình (quyền ticket.config)
```

### 10.5 Cron `ticketSweepJob` (mỗi 5 phút)

- `auto_close_at <= now` → tự đóng; nhắc trước khi tự đóng `waiting_info`; nhắc ngày kiểm tra "Cần theo dõi
  thêm".
- **Cảnh báo vàng không cần cron**: `alert_at` được tính trước mỗi lần ticket thay đổi; lúc đọc, ticket còn mở
  có `alert_at <= now` là vàng (tab "Cần chú ý" = query theo index `alert_at`).
- `auto_close_at` cũng tính trước mỗi lần ticket thay đổi, nên cron chỉ query theo index.
- Khoá Redis **có tiền tố môi trường** (`${ENV_PREFIX}:lock:ticket:sweep`), release nguyên tử.

### 10.6 Tránh lặp lỗi đã thấy khi phân tích dự án

- Transaction (`runInTransaction`) khi ghi ticket + lịch sử + tin nhắn/file.
- Kiểm tra quyền ở **mọi** API theo id (chống IDOR), kể cả URL file.
- Escape từ khoá trước khi đưa vào `$regex`.
- Upload: thư mục riêng tư, `fileFilter`, `limits`, không phục vụ qua `/static`.
- Handler sự kiện: log lỗi, không `.catch(() => {})` im lặng.
- Không bao giờ log nội dung file nhạy cảm hay nội dung trao đổi ở production.

## 11. Giai đoạn

1. **MVP (web)**: cấu hình sản phẩm/loại/mẫu (seed mục 2.2); tạo, sửa, nhận, giao (phòng/người, chủ trì/phối
   hợp); đủ trạng thái, kết quả, ghi chú; checklist bổ sung; tờ trình bằng file + xác nhận hợp lệ; trao đổi
   - file (nhạy cảm); thêm/bớt phối hợp; ticket thường/hạn chế; thông báo theo quy tắc; tự đóng/mở lại; cảnh báo
     vàng + lịch làm việc có T7 sáng; danh sách theo ngày; lịch sử; trùng/liên quan; tạo mới từ ticket cũ.
2. **Giai đoạn 2**: checklist các bước thực hiện theo mẫu (vd đổi SĐT: kiểm tra SĐT mới → sửa DB sản phẩm →
   sửa CRM vWork → báo khách); báo cáo tỉ lệ xử lý kịp; API cho app mobile.
3. **Giai đoạn 3**: duyệt tờ trình điện tử trên vWork (mục 5.2), đánh giá hài lòng, xuất Excel.

## 12. Điểm chờ code `[CHỜ-DUYỆT-ĐIỆN-TỬ]`

Tìm bằng `grep -rn "CHỜ-DUYỆT-ĐIỆN-TỬ" src`. Hiện có 6 điểm:

| File                                                                   | Điểm chờ                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/modules/ticket/domain/types.ts`                                   | `ApprovalMode` chỉ có `"document"`; `TICKET_STATUSES` sẽ thêm `pending_approval` |
| `src/modules/ticket/domain/ticket.entity.ts` — `_assertApprovalPassed` | "Cổng duyệt" duy nhất: tách thành `ApprovalGate` theo `approval.mode`            |
| `src/modules/ticket/domain/ticket.entity.ts` — `verifyApproval`        | Lệnh xác nhận tờ trình sẽ thay bằng duyệt/từ chối theo từng cấp                  |
| `src/modules/ticket/domain/ticket-capabilities.ts`                     | Ai được nút "xác nhận tờ trình" sẽ theo lượt duyệt hiện tại                      |
| `src/models/TicketModel.ts` — `approval`                               | Thêm `mode: "electronic"`, danh sách cấp duyệt                                   |
| `docs/TICKET-MODULE-PLAN.md` mục 5.2                                   | Mô tả hướng chuyển đổi                                                           |

## 13. Cần chốt khi seed dữ liệu (không chặn việc code)

- Tên cụ thể của **A, B** (người phụ trách mẫu "Reset thiết bị") và danh sách **người phụ trách IT mặc định**.
- Danh sách role/người thuộc **ban lãnh đạo**, **trưởng IT**, **IT** để gán quyền mục 10.3.
- `waiting_info` tự đóng: đã hiểu là **đồng bộ 3 ngày làm việc** như `resolved` — chỉnh trong cấu hình nếu
  muốn khác.

## 14. Đã triển khai (API) — 23/10/2026

Nhánh `feat/ticket`. Khớp thiết kế ở trên, trừ các điều chỉnh sau khi code (cái nào khác thiết kế đều ghi
rõ ở đây).

### Code mới

| Phần                     | File                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lịch làm việc dùng chung | `src/shared-kernel/working-calendar.ts` (chuyển từ customer-care, thêm `dayWindows`: T7 chỉ buổi sáng)                                                                                                                                                      |
| Domain                   | `src/modules/ticket/domain/` — `ticket.entity.ts` (máy trạng thái), `ticket-access.ts` (quyền xem), `ticket-capabilities.ts` (nút nào hiện), `ticket-schedule.ts` (cảnh báo vàng / tự đóng / mở lại), `ticket-catalog.ts` (checklist bổ sung, nhãn kết quả) |
| Application              | `src/modules/ticket/application/` — `ticket-commands.service.ts`, `ticket-queries.service.ts`, `ticket-sweep.service.ts`, `ticket-config.service.ts`, `ticket-notification.policy.ts` (bảng ai nhận thông báo)                                              |
| Infrastructure           | `src/modules/ticket/infrastructure/` — repository có kiểm tra `version`, mapper, directory (nhân viên/phòng ban), notifier, cấu hình                                                                                                                        |
| HTTP                     | `src/modules/ticket/interface/` — route `/tickets` (đăng ký ở `src/routes/index.js`)                                                                                                                                                                        |
| Models                   | `src/models/Ticket*.ts` (9 collection: `ticket`, `ticket_message`, `ticket_attachment`, `ticket_activity`, `ticket_product`, `ticket_category`, `ticket_template`, `ticket_setting`, `ticket_counter`)                                                      |
| Upload                   | `src/middlewares/uploadTicket.js` (thư mục riêng `TICKET_DIR_*`, chỉ nhận định dạng an toàn, tối đa 25MB × 10 file)                                                                                                                                         |
| Cron                     | `src/jobs/ticketSweepJob.js` — 5 phút/lần, khoá Redis có tiền tố môi trường                                                                                                                                                                                 |
| Seed                     | `scripts/seedTicketConfig.ts`, `scripts/seedPermissionTicketRoles.ts`; thêm quyền `ticket.*` vào các seed permission có sẵn                                                                                                                                 |

### Khác với thiết kế ở trên

- **Khách hàng:** ticket nhận snapshot khách (`customer`: SĐT, tên, app, id CRM) do **client gửi lên** — server không
  tra lại CRM. Lý do: tra theo id sẽ lộ tên/SĐT khách ngoài phạm vi của người tạo; frontend chọn khách qua API khách
  hàng hiện có (đã lọc theo phạm vi) rồi điền vào. Người tạo vẫn nhập tay SĐT được.
- **Nhân sự liên quan (27/10/2026):** sản phẩm nội bộ (không có `app_code`: CRM/HRM/Workplace) thì bước 2 của form là
  "Nhân sự liên quan" — chọn nhân viên qua `GET /tickets/directory/employees` (tìm theo tên, mã NV, **SĐT**; SĐT bỏ
  số 0 / +84 đầu khi so) — thay cho ô khách. Ticket lưu `related_employee_id` (server kiểm tra nhân viên tồn tại),
  chi tiết/danh sách trả `relatedEmployee` (tên lấy lúc đọc). Sản phẩm app (VNFITE/TIKLUY) giữ ô khách như cũ. Chưa
  cho sửa sau khi tạo, và nhân sự được gắn chưa tự được xem / nhận thông báo ticket.
- **"Tạo ticket mới từ ticket này"** làm ở frontend (điền sẵn form + `relatedTicketIds`), không có endpoint `/clone`.
- **Đường dẫn cấu hình:** `/tickets/config/{products|categories|templates}` và `/tickets/config/settings` (không phải
  `/ticket-config`).
- **1 "ngày làm việc" = 540 phút** (ca hành chính 08:00–17:00 liên tục, lịch không trừ nghỉ trưa) — nên "3 ngày làm
  việc" từ 16:00 thứ Sáu = 60' (T6) + 240' (sáng T7) + 540' (T2) + 540' (T3) + 240' → **12:00 thứ Tư**. Mục 8.4 ghi
  ví dụ theo 8 giờ/ngày là chưa chính xác; con số 540 sửa được ở cài đặt chung (`workday_minutes`).
- **Cảnh báo vàng không cần cron:** `alert_at` được tính lại sau mỗi thay đổi; lúc đọc, ticket còn xử lý dở có
  `alert_at <= now` là vàng. Cron chỉ lo tự đóng + nhắc.
- **Tải file** qua `GET /tickets/:id/attachments/:attachmentId/download` có kiểm tra quyền (frontend tải dạng blob),
  không dùng URL ký; Content-Type theo đuôi file chứ không tin mimetype client khai.
- **Thông báo thêm so với bảng 7.2:** ticket được **mở lại** → báo chủ trì; ticket **tự đóng** → báo người tạo.
- **Người nhận thông báo ticket mới:** cộng dồn mẫu + loại yêu cầu + sản phẩm; ticket Khẩn / Cao thêm cài đặt chung
  (`default_handler_ids`) — xem 7.1. (Cách "dùng cấp đầu tiên có cấu hình" đã bỏ từ 26/10/2026.)
- **Tin nhắn:** của nhóm xử lý tính là "hoạt động" (đếm lại cảnh báo im lặng); của người tạo thì không, và không đổi
  `version` ticket.

### Triển khai (theo thứ tự)

1. Thư mục file: **không cần thêm env hay mount** — mặc định lưu ở `UPLOAD_DIR_PROD/ticket` (vd
   `/var/www/vWork/live/private/ticket`), nằm trong volume `private` đã mount nên bền qua redeploy và đi theo sao lưu
   của `private`. Chỉ đặt `TICKET_DIR_PROD` (+ mount riêng) nếu muốn tách ra chỗ khác.
2. Seed quyền: `npx ts-node --transpile-only scripts/seedPermissionAll.ts` (thêm permission `ticket.*`, data scope
   `TICKET_ALL_COMPANY`, cập nhật role EMPLOYEE_BASELINE / DEPT_LEAD / COMPANY_EXECUTIVE, tạo role
   `WORKPLACE_TICKET_STAFF` "Nhân viên hỗ trợ ticket", `WORKPLACE_TICKET_MANAGER` "Quản lý ticket hỗ trợ" — ticket
   thuộc phân hệ Workplace nên role theo quy ước `WORKPLACE_*`). **Xoá cache quyền**
   (`scripts/invalidateAllPermissionCache.ts`) để người dùng nhận quyền mới.
3. Seed cấu hình: `npx ts-node --transpile-only scripts/seedTicketConfig.ts` (chỉ tạo mới, không ghi đè cấu hình
   đã chỉnh).
4. Gán role `WORKPLACE_TICKET_STAFF` cho IT và `WORKPLACE_TICKET_MANAGER` cho trưởng IT ở màn Phân quyền; trên màn cấu hình ticket gán
   Từ 30/10/2026 `ticket.handle` **không còn** ở role nhân viên: IT gán `WORKPLACE_TICKET_STAFF`; người của đơn vị khác được giao việc (Kế toán, QTRR, ĐVKD) gán `WORKPLACE_TICKET_HANDLER`, nếu không sẽ không nhận được dù được giao.
   người phụ trách (A, B cho mẫu "Reset thiết bị"; danh sách mặc định cho IT).

### Kiểm thử

`__tests__/modules/ticket/` (+ `__tests__/shared-kernel/working-calendar.test.ts`): domain (entity, lịch cảnh
báo/tự đóng, quyền xem), service tích hợp với Mongo in-memory có transaction (đua 2 người cùng nhận, version, tờ
trình, tự đóng/nhắc), chính sách thông báo, bộ lọc danh sách, và **HTTP** (supertest: route, multipart, file nhạy cảm,
cấu hình). Chạy: `npx jest __tests__/modules/ticket`.

## 15. Đã triển khai (web) — 23/10/2026

Repo `vWork-website`, nhánh `feat/ticket`, thư mục `src/features/ticket/` + 3 trang
`src/pages/workplace/Ticket{s,Detail,Config}Screen.jsx`. Menu "Ticket hỗ trợ" nằm trong Workplace (chỉ hiện với
người có quyền ngoài role nhân viên mặc định: `ticket.handle`, `assign_*`, `view_restricted`, `view_sensitive`, `manage`, `config`; thêm lối vào ở CRM → CSKH & Call Center cho người có `ticket.view`); thông báo ticket mở thẳng `/workplace/tickets/:id`.

| Route | Nội dung |
|---|---|
| `/workplace/tickets` | Danh sách nhóm theo ngày, 6 tab + chip (mục 16) có số đếm, bộ lọc; **ticket bị bỏ quên được bôi vàng** |
| `/workplace/tickets/:id` | Chi tiết: thông tin, trao đổi (@nhắc tên, file), nhóm xử lý, tờ trình, file đính kèm, lịch sử; thanh hành động |
| `/workplace/tickets/config` | Cấu hình (quyền `ticket.config`): sản phẩm, loại yêu cầu, mẫu yêu cầu, cài đặt chung (người phụ trách, ngưỡng cảnh báo, tự đóng/mở lại, lịch làm việc) |

Thiết kế giao diện:

- **Nút nào hiện do backend quyết định** (`ticket.capabilities` trong `GET /tickets/:id`), frontend không tự suy
  luận quyền. Hành động có nhập liệu là bảng dữ liệu `components/actions/ticketActions.js` (nhãn, trường, cách dựng
  body) + 1 hộp thoại dùng chung — thêm hành động mới chỉ cần thêm 1 mục.
- **Form tạo ticket dựng từ mẫu yêu cầu** (`TicketDynamicFields`): thêm mẫu/trường ở màn cấu hình là form tự có.
  Tiêu đề gợi ý từ `title_pattern`, người tạo vẫn sửa được.
- **Tìm khách trong CRM** (`CustomerPicker`) chỉ hiện khi người dùng có `customer.view`; không thì nhập tay SĐT/tên.
- **File nhạy cảm không còn quyền xem** chỉ hiện dòng thông tin (loại giấy tờ, người tải, thời gian), không có tên
  file; tải file qua API dạng blob (có token), không dùng link tĩnh.
- Người tạo ticket hạn chế đã đóng thấy **màn thông tin chung** (mã, tiêu đề, trạng thái, kết quả, ghi chú) và nút
  "Mở lại" nếu còn hạn.
- Điểm chờ duyệt điện tử: `TicketApprovalCard.jsx` (nhãn `[CHỜ-DUYỆT-ĐIỆN-TỬ]`).

Đã kiểm tra trên trình duyệt với **API thật + Mongo in-memory** (auth/permission giả): tạo ticket theo mẫu, nhận,
yêu cầu bổ sung (có tờ trình), người tạo bổ sung kèm file, xác nhận tờ trình, báo xong có "cần theo dõi thêm",
người tạo xác nhận (→ màn thông tin chung), cấu hình + lưu cài đặt, danh sách nhóm theo ngày với cảnh báo vàng.

### Chưa làm / còn mở

- Giai đoạn 2/3 ở mục 11 (checklist bước thực hiện theo mẫu, báo cáo tỉ lệ xử lý kịp, duyệt tờ trình điện tử,
  app mobile...).
- Web chưa có test tự động (dự án web chưa cài framework test); đã kiểm tra tay như trên và `vite build`.
- Cài đặt lịch làm việc theo từng thứ trên màn cấu hình mới hỗ trợ riêng **thứ 7** (khung giờ riêng); API hỗ trợ
  khung giờ riêng cho thứ bất kỳ.
- Chưa kiểm tra trên môi trường UAT thật (cần chạy seed quyền + seed cấu hình trước).

## 16. Thanh tab danh sách (thiết kế lại 26/10/2026)

Tab dạng viên thuốc (cùng kiểu màn Đơn từ). Backend nhận `GET /tickets?tab=<tab>&scope=<chip>`; `scope` lạ rơi về `all`.

| Tab | Nội dung | Chip (scope) |
|---|---|---|
| **Ticket của tôi** (`my`) | Tôi tạo + tôi xử lý (chủ trì/phối hợp) + giao đích danh cho tôi, **gồm cả ticket đã đóng** | Tất cả · Đang mở (`open`) · Tôi tạo (`created`) · Tôi đang xử lý (`handling`) · Giao cho tôi (`assigned`) |
| **Cần tôi phản hồi** (`needs_reply`) | Ticket tôi tạo đang `waiting_info` hoặc `resolved` | — |
| **Chưa ai nhận** (`unclaimed`) | Ticket `open`, chưa giao ai (`mode = none`) — cả công ty nhận được | — |
| **Ticket phòng ban** (`department`) | Giao cho phòng tôi (gồm phòng cha) + việc của người trong phòng tôi (gồm phòng con) | Tất cả của phòng · Giao cho phòng, chờ nhận (`waiting`) · Phòng đang xử lý (`handling`) · Do phòng tạo (`created`) |
| **Cần chú ý** (`yellow`, trước đây tên "Cảnh báo vàng") | Như mục 8 (sắp theo `alert_at`) | — |
| **Tất cả** (`all`) | Mọi ticket được xem (kể cả đã đóng / huỷ) | — (lọc trạng thái bằng ô "Trạng thái" ở thanh bộ lọc, gửi `status`) |

- Số đếm (`GET /tickets/counts`) chỉ đếm phần cần hành động: `my` = ticket đang mở, `department` = chờ phòng nhận, kèm
  `needs_reply`, `unclaimed`, `yellow`.
- Các tab hàng đợi (Của tôi / Chưa ai nhận / Phòng ban) loại trừ nhau; `needs_reply` và `yellow` là "góc nhìn" nên chồng lấn.
- Thay cho 8 tab cũ (`mine`, `created`, `assigned_to_me`, `my_department`, `closed`...); các khoá cũ không còn.

## 17. Thao tác nhanh trên danh sách (28/10/2026)

Mỗi dòng ở danh sách có thể thao tác ngay, không phải vào trang chi tiết. `GET /tickets` trả thêm `capabilities` (cùng
hàm `capabilitiesOf` với chi tiết) và `version` cho từng dòng; server vẫn kiểm tra lại ở mọi thao tác. Nút nào hiện =
server báo được phép (`capabilities`) VÀ người dùng có quyền thô của route.

**Mọi tab như nhau:** cùng một ticket thì có cùng thao tác ở mọi tab, kể cả "Tất cả" (`components/actions/ticketQuickActions.js`) —
không tab nào ẩn thao tác; nút nào hiện chỉ do `capabilities` của dòng và quyền thô của người dùng quyết định.

**Các thao tác làm ở danh sách:** Nhận xử lý, Tiếp tục xử lý, Báo đã xử lý xong, Tạm hoãn, Trả lại, Yêu cầu bổ sung, Giao việc,
Đặt ngày dự kiến, Đóng ticket, Tờ trình hợp lệ / không hợp lệ, Xác nhận đã xong, Mở lại, Huỷ yêu cầu. Vẫn làm ở chi tiết:
bổ sung của người tạo (cần tải file), thêm người phối hợp, liên kết ticket, sửa thông tin.

- Quyền thô: `ticket.handle` cho nhận / tiếp tục / báo xong / tạm hoãn / trả lại / yêu cầu bổ sung / đặt ngày / đóng;
  `ticket.create` cho xác nhận / huỷ; giao việc, tờ trình, mở lại chỉ cần `ticket.view` (domain kiểm tra theo từng ticket).
- "Báo đã xử lý xong" bị ẩn khi ticket cần tờ trình mà chưa được xác nhận hợp lệ (server sẽ từ chối); khi đó hộp thoại
  "Đóng ticket" cũng không cho chọn kết quả "Đã giải quyết" (`actions/resolutionOptions.js`).
- Giao diện: bố cục từng dòng chọn theo **độ rộng thật của vùng danh sách** (hook `useElementWidth`, đo bằng
  `ResizeObserver`), KHÔNG theo độ rộng cửa sổ — cùng một cửa sổ nhưng có thanh bên thì vùng nội dung hẹp hơn nhiều.
  Ba bố cục, ngưỡng ở `TicketList.jsx` (`WIDE_MIN = 900`, `MEDIUM_MIN = 560`):
  - **Rộng (≥ 900px, 3 cột):** thao tác gắn vào hàng chip ở cột 3 — chip trạng thái bấm được (có mũi tên) mở menu các
    thao tác; riêng ticket chưa ai nhận có thêm nút cam "Nhận xử lý" ngay đầu hàng chip.
  - **Vừa (560–899px, 2 cột):** dòng đầu (mã, tiêu đề) chiếm cả hàng; bên dưới là cột thông tin và cột chip + nút chính
    kèm menu "⋮" cho các thao tác còn lại.
  - **Hẹp (< 560px, 1 cột):** xếp dọc, nút chính nằm dưới chip kèm menu "⋮".
  Mọi khối con bị chặn `maxWidth: 100%`, chữ dài tự xuống dòng / cắt `…` nên không tràn sang cột bên cạnh.
  Mục nguy hiểm (huỷ, tờ trình không hợp lệ) trong menu có màu đỏ. Hộp thoại và hộp hỏi xác nhận dùng lại đúng các thành phần của màn chi tiết
  (`TicketActionDialog`, `TicketConfirmDialog`, `useTicketActionRunner`, `useTicketRowActionFlow`, bảng `ticketActions.js`).
- Mọi thao tác ghi gửi kèm `version` đang hiển thị: ticket bị người khác đổi giữa chừng thì báo "tải lại để xem"
  (409) thay vì ghi đè. `claim` không cần `version` vì đã tự chống nhận trùng.

## 18. Thẻ "Thông tin" ở màn chi tiết (28/10/2026)

Thẻ được làm gọn (khoảng 480px thay vì 730px) mà không bỏ thông tin nào (`components/detail/TicketInfoCard.jsx`):

- **Phân loại** là một hàng chip `sản phẩm › loại yêu cầu › mẫu` đặt dưới hộp cảnh báo, không có mục riêng; hẹp thì xuống dòng.
- **Nội dung yêu cầu** gộp mô tả và các trường theo mẫu vào một khối (vạch cam mảnh bên trái, không nền): mô tả ở trên,
  các trường theo mẫu sau một đường nét đứt, cuối cùng là dòng nhỏ ghi người tạo và giờ tạo. Mô tả dài vẫn thu gọn + "Xem thêm".
- **Khách hàng** trên một hàng (tự xuống dòng khi hẹp): avatar + tên (bấm mở hồ sơ CRM nếu `customerAccess.canOpenProfile`),
  số điện thoại kèm nút sao chép, chip ứng dụng, nút "User ID" (sao chép mã khách; chỉ khi `customerAccess.showExternalId`; mã đầy đủ ở
  tooltip, không còn ô "Mã khách (User ID)" và ô "Ứng dụng" riêng). Cảnh báo "Khách chưa có trong CRM" giữ nguyên bên dưới.
- Hộp "Chờ người tạo bổ sung" còn 2 dòng: các mục cần bổ sung nối bằng `;`, rồi dòng giờ tự đóng.

## 19. Rà soát 28/10/2026: các quy tắc đã chỉnh

- **Quyền xem ticket hạn chế (mục 6.1):** người được giao đích danh (`memberIds`) chỉ tính là "liên quan" khi ticket CHƯA có chủ trì.
  Có chủ trì rồi thì quyền xem thuộc về nhóm xử lý hiện tại (chủ trì + phối hợp): người bị gỡ / đã trả lại không còn xem được ticket
  hạn chế và file nhạy cảm (`isInvolved`, `visibilityFilter`).
- **Không kẹt ở "Tạm hoãn":** khi `release` (chủ trì duy nhất trả lại) hoặc `assign` (giao cho phòng / người không kèm chủ trì) làm ticket
  mất chủ trì, ticket đang `in_progress` HOẶC `on_hold` đều quay về `open` và xoá thông tin tạm hoãn.
- **Nhận ticket đã có phối hợp thêm sớm:** người nhận được loại khỏi danh sách phối hợp (không còn lỗi 400); giao đích danh thì giữ cả
  người phối hợp thêm sớm. Gỡ phối hợp ở ticket giao đích danh cũng gỡ người đó khỏi `memberIds` để lần nhận sau không thêm lại.
- **`capabilities.resolve`** chỉ bật khi ticket không cần tờ trình hoặc tờ trình đã `verified` (khớp `TicketEntity.resolve`).
- **Danh sách / tìm kiếm với ticket hạn chế đã kết thúc:** người liên quan (không có quyền xem ticket hạn chế) chỉ thấy thông tin chung như
  màn chi tiết (mã, tiêu đề, trạng thái, kết quả, người tạo); không trả khách, sản phẩm, loại, chủ trì, SĐT ở ô tìm kiếm.
- **Lịch sử đọc được:** `note` của dòng thêm/gỡ phối hợp là TÊN người, "liên kết" là MÃ ticket, "giao việc" là kiểu giao; `changes` của
  `productId` / `categoryId` là tên.
- **Tờ trình bổ sung:** `hasKindSince` chỉ tính file do chính người tạo tải lên (file người xử lý đăng trong trao đổi không thay được).
- **File nhạy cảm trong trao đổi:** thêm loại `sensitive_other` ("Giấy tờ nhạy cảm khác") vào `DEFAULT_SENSITIVE_KINDS`; khung trao đổi
  có ô "Tệp nhạy cảm" gửi file với loại này.
- **Thông báo "ticket mới":** sự kiện tạo mang cờ `ownerAtCreation`; ticket tạo ra đã có chủ trì không báo "có ticket mới cần nhận"
  (nhóm xử lý được báo qua sự kiện giao việc).
- **Cron nhắc / tự đóng:** đọc lại ticket rồi kiểm tra lại trạng thái + mốc (`autoCloseAt`, `remindAt`); đánh dấu "đã nhắc" bằng lệnh có điều
  kiện, tăng `version`, TRƯỚC khi gửi (gửi lỗi thì trả mốc về như cũ) nên quét chồng nhau hoặc người dùng ghi cùng lúc không gửi lặp.
- **Kiểm tra ở cửa API:** `code` đóng ticket, `urgency`, mọi ObjectId (sản phẩm, loại, mẫu, người, phòng, ticket liên kết, `mentionIds`, bộ lọc
  danh sách) sai định dạng → 400 thay vì 500 / lưu giá trị lạ. `PATCH` bỏ qua trường rỗng thay vì lưu "null".
- **`PATCH /tickets/:id` / `searchEmployees(assignable)`:** tìm người giao việc lọc theo phòng ngay trong câu truy vấn (không cắt 50 người rồi mới lọc).
- **Ngưỡng cảnh báo vàng:** cập nhật một phần lưu LẠI ĐỦ các mức đã gộp (không đặt lại các mức còn lại về mặc định).
- **Khách (CRM) `getDetailInfo` / `getFluctuation` / `getCustomerInvestmentHolding`:** không in số CCCD ra log; `external_id` phải là chuỗi;
  hệ thống khách quá chậm → 504, lỗi kết nối → 502; không có hồ sơ chi tiết → 404 (không để request treo).
- **Web:** trang chi tiết đặt `key={ticket.id}` (đổi ticket thì reset hộp thoại / nháp trao đổi); nút ở chi tiết lọc cùng quy tắc với danh sách
  (`availableActionKeys`: capabilities + quyền route + chặn "Báo xong" khi tờ trình chưa hợp lệ); danh sách / chi tiết / số đếm `staleTime` 15 giây;
  409 đóng hộp thoại và tải lại thay vì gửi lại ngầm; liên kết sang hồ sơ khách mang `?app=` để trang CRM tự chọn đúng công ty.
- **Chưa đổi (cần quyết định sản phẩm):** `ensureCustomerAccessByExternalId` chưa lọc theo app (các API khách luôn gọi hệ thống TIKLUY);
  giao ticket cho phòng ban luôn xoá nhóm xử lý hiện tại và trưởng phòng giao lại được ticket phòng khác đang làm; link HRM mở trang 403 với
  nhân viên ngoài phạm vi được xem.

## 20. Link từ ticket sang hồ sơ khách / nhân viên: đúng đích, đúng quyền

`GET /tickets/:id` (`interface/ticket-profile-access.ts`) bổ sung, tính theo TỪNG hồ sơ (không chỉ "có quyền xem" mà cả phạm vi dữ liệu):

| Đối tượng | Trường trả về | Đích |
| --- | --- | --- |
| Khách app **TIKLUY** | `customerAccess.profileTarget = "detail"` | `/khach-hang/<external_id>?app=tikluy` (chi tiết khách) |
| Khách app **VNFITE** (và app khác) | `profileTarget = "list"` | `/khach-hang?app=vnfite&search=<SĐT>` (danh sách khách của app, tìm sẵn theo SĐT) |
| Khách nhập tay / ngoài phạm vi dữ liệu của người xem | `profileTarget = null`, `canOpenProfile = false` | không có link |
| Nhân sự nội bộ (sản phẩm vWork: CRM, HRM, Workplace) | `relatedEmployee.canOpenProfile` (employee.view + phạm vi) | `/hrm/employee/<id>` |

- Lý do khách VNFITE chỉ dẫn tới danh sách: trang chi tiết khách lấy hồ sơ, biến động số dư, khoản đầu tư từ CMS **TIKLUY** (các API
  `/crm/...`); CMS VNFITE không có các API đó. Khách được tìm theo `customerId` (ưu tiên) hoặc `external_id` + app, không lẫn giữa các app.
- `getDetailInfo` / `getFluctuation` / `getCustomerInvestmentHolding` chỉ nhận khách của app TIKLUY; khách app khác trả 404 với câu
  "Chi tiết khách hàng chỉ hỗ trợ app <tên app>".
- Trang danh sách khách (`CustomerScreen`) đọc `?app=` (chọn đúng công ty CRM một lần khi mở) và `?search=`.

## 21. Đối chiếu với tài liệu "Hướng dẫn gửi ticket hỗ trợ trên CRM" (30/10/2026)

Nguồn: bản đề xuất 19/10/2026 (đơn vị kinh doanh, QTRR, Kế toán, Hỗ trợ vận hành báo lỗi CRM / hồ sơ vay vướng cho IT). Các điểm lệch đã chốt:

| Nội dung tài liệu | Quyết định | Triển khai |
| --- | --- | --- |
| Người nhận: IT và quản trị CRM | Chỉ người có `ticket.handle` nhận / xử lý, không để mọi nhân viên | Bỏ `ticket.handle` khỏi `EMPLOYEE_BASELINE`; thêm vào `WORKPLACE_TICKET_STAFF` (`seedPermissionTicketRoles.ts`) |
| Việc thuần nghiệp vụ → IT chuyển về đơn vị chủ trì | IT giao được cho phòng ban | `WORKPLACE_TICKET_STAFF` có `ticket.assign_department` |
| Menu CSKH & Call Center | Giữ ticket ở Workplace, thêm lối vào ở CRM; Workplace chỉ hiện cho người có quyền không phải mặc định | `WorkplaceMenuItems.js` (`permissionAny` các quyền ticket ngoài view/create), `CrmMenuItems.js` (mục "Ticket hỗ trợ" trỏ `/workplace/tickets`) |
| Sản phẩm "CRM VNFITE" | Chính là **VNFITE APP**, không thêm sản phẩm | — |
| Loại ticket (Lỗi hệ thống / Hồ sơ vay) | Bỏ qua, không thêm loại; dùng loại "Lỗi / sự cố" | Hai mẫu mới `system_error`, `loan_file_stuck` thuộc loại này (`seedTicketConfig.ts`) |
| Mã hồ sơ | Không bắt buộc, hiện **theo sản phẩm**: TIKLUY → mã khoản đầu tư, VNFITE → mã khoản vay. Chưa tra cứu bước / đơn vị / cờ SLA của hồ sơ (giai đoạn sau, cần API từ hệ thống hồ sơ vay) | Trường mẫu có `app_codes` (model `TicketTemplateModel`, `ticket-commands.service.ts`, `TicketDynamicFields`, màn cấu hình mẫu) |
| Mô tả 4 ý (đang làm gì, mong đợi, thực tế, thời điểm) | Chỉ ghi chú hướng dẫn, người gửi tự viết vào mô tả vì không ca nào cũng đủ ý | Nằm trong `guidance` của 2 mẫu mới |
| Ảnh chụp màn hình bắt buộc với "Lỗi hệ thống" | Có | Giấy tờ bắt buộc `screenshot` của mẫu `system_error` |
| Hướng dẫn tự kiểm tra trước khi gửi (F5, đúng hồ sơ / bước, có nút sẵn chưa) và danh sách không dùng ticket cho… | Có | `guidance` của 2 mẫu mới |
| Thời hạn phản hồi đầu tiên (Khẩn 30 phút … Thấp 1 ngày) | Dùng ngưỡng "chưa ai nhận" làm thời hạn phản hồi | Seed cài đặt tạo mới (8.3) |
| Thời hạn xử lý xong | Chỉ là mốc tham khảo, giữ triết lý cảnh báo vàng | Không đổi code |
| Ticket Khẩn không ai nhận | Nhắc người phụ trách khi bị vàng | Bước 3 của `ticket-sweep.service.ts` (+ `alert_notified_for` ở `TicketModel`) |
| Báo người tạo mỗi lần đổi trạng thái | Thêm tạm hoãn / tiếp tục / quay về hàng chờ nhận | `ticket-notification.policy.ts` (`planStatusChange`) |
| Giờ làm việc 08–12, 13–17, T2–T6 | Bỏ thứ 7, ngày làm việc 480 phút; chưa trừ nghỉ trưa | Seed cài đặt tạo mới (8.4) |
| (Phát sinh) Ai xem được ticket thường | Nhân viên thường chỉ xem ticket của mình và người cùng phòng; người xử lý / quản lý xem hết (không thêm cờ theo ticket hay theo mẫu) | `TicketActor.canViewAll` + `colleagueIds` (`ticket-actor.ts`), `accessLevel`, `visibilityFilter`; `meta.me.canViewAll`; web ẩn tab "Chưa ai nhận" với nhân viên thường; ticket chỉ hiện ở CRM (người có quyền CRM) hoặc Workplace (còn lại) |

**Không làm (đã chốt bỏ qua):** thêm loại "Hồ sơ vay", mẫu "Mở lại hồ sơ đóng nhầm" (ticket đã có nút "Mở lại" riêng), trường "Kênh liên hệ nhanh", cảnh báo khi ghi CCCD / SĐT khách vào tiêu đề và mô tả.

**Việc phải làm khi triển khai** (seed chỉ tạo mới / cập nhật định nghĩa role, không đụng dữ liệu đã chỉnh):

1. `npx ts-node --transpile-only scripts/seedPermissionAll.ts` (cập nhật role nhân viên + role ticket), rồi `scripts/invalidateAllPermissionCache.ts`.
2. Gán `WORKPLACE_TICKET_STAFF` cho IT; gán `WORKPLACE_TICKET_HANDLER` (chỉ có `ticket.handle`, không xem file nhạy cảm, không giao phòng ban) cho người của đơn vị khác được giao việc (vd Kế toán). Người chưa có quyền nào vẫn tạo và xem ticket được, nhưng nhận / xử lý thì bị từ chối (403).
3. `npx ts-node --transpile-only scripts/seedTicketConfig.ts` để tạo 2 mẫu mới. Cài đặt chung đã có trong DB không bị ghi đè: vào Cấu hình → Cài đặt chung để đặt ngưỡng "chưa ai nhận" (30 phút / 1 giờ / 4 giờ / 1 ngày), ngày làm việc 480 phút, bỏ thứ 7.
4. Gán người phụ trách cho mẫu / sản phẩm VNFITE APP trên màn Cấu hình (người nhận thông báo, kể cả nhắc ticket Khẩn / Cao chưa ai nhận).
5. Ticket hỗ trợ chỉ hiện ở **một** nơi, theo quyền CRM (`CRM_ACCESS_PERMISSIONS` — cũng là điều kiện vào layout CRM): người **có** quyền CRM thấy mục "Ticket hỗ trợ" ở CRM → CSKH & Call Center (`/ticket-ho-tro`, kèm huy hiệu số ticket cần để ý); người **không có** thấy mục "Ticket hỗ trợ" ở Workplace (`/workplace/tickets`). Mục Workplace có cờ `hiddenWhenCrmAccess` (`WorkplaceMenuItems.js`, đọc ở `WorkplaceLayout.jsx`). Role nhân viên cơ bản không có quyền CRM nào nên nhân viên thường thấy ở Workplace. Phạm vi dữ liệu do backend quyết định (6.1).
6. Link `/workplace/tickets`, `/workplace/tickets/config`, `/workplace/tickets/:id` (thông báo đẩy, link gửi nhau, gõ tay) tự chuyển sang `/ticket-ho-tro...` nếu người mở có quyền CRM (`WorkplaceTicketRoute.jsx`); thông báo trong web cũng mở thẳng bản CRM với người có quyền CRM (`Header.jsx`). Test phân quyền thật: `__tests__/modules/ticket/ticket-real-permissions.test.ts`.
7. Nhân viên thường dùng chính mục "Ticket hỗ trợ" để gửi và theo dõi (tab "Ticket của tôi", "Ticket phòng ban"). Trưởng bộ phận muốn điều phối ticket phải được giao ticket cho phòng (hoặc gán `WORKPLACE_TICKET_STAFF`).
8. Hộp thoại "Bổ sung thông tin" của người tạo có ô **Nội dung bổ sung**: lưu thành tin nhắn của người tạo trong phần trao đổi (`submit-info` nhận `note`). Bắt buộc nhập khi người xử lý hỏi mục chỉ trả lời được bằng chữ (`input: "text"` ở `INFO_REQUEST_CATALOG`: mô tả, các bước tái hiện, SĐT / CCCD khách, mã khoản đầu tư / vay, số tiền và thời điểm, căn cứ); mục `file` / `either` thì ô này không bắt buộc. Lời nhắc trong hộp thoại hiện từng mục kèm ghi chú của người xử lý.

## 22. Rà soát toàn luồng 30/10/2026: các lỗi đã sửa

| Nhóm | Lỗi | Cách sửa |
| --- | --- | --- |
| Quyền | Ban lãnh đạo (`ticket.manage`, không có `handle`) không đóng hộ được: route đòi `ticket.handle` | Thêm `requireAnyPermission`; các route thao tác nhóm xử lý nhận `handle` **hoặc** `manage` (10.3); web cũng gating theo cả hai |
| Giao việc | Giao / mời phối hợp cho người không có `ticket.handle` làm ticket kẹt (nhận, trả lại, báo xong đều 403) | `assertCanHandle` ở `authorizeAssignment` và `addCollaborator` (báo lỗi 400 kèm tên); ô chọn người giao chỉ gợi ý người có quyền. Giao cho **phòng ban** thì không kiểm tra được từng thành viên — gán role cho người của phòng đó |
| Cron | Lần quét đầu sau triển khai báo dồn mọi ticket Khẩn / Cao đã vàng | Bước nhắc chỉ lấy ticket có trường `alert_notified_for` (ticket tạo từ nay có sẵn, mặc định null); ticket cũ không bị báo dồn |
| Cron | Cờ "đã nhắc" vẫn ghi dù gửi hỏng (notifier nuốt lỗi) | `TicketNotification.strict`: cron nhận lỗi khi không gửi được cho ai để bỏ cờ và thử lại |
| Seed | `seedTicketConfig` tạo lại sản phẩm / loại / mẫu admin đã xoá mềm | Lọc theo `code` (không kèm `isDeleted`); mẫu của loại đã xoá thì bỏ qua |
| Seed | Thiếu `silent_minutes` → ngưỡng "im lặng" tính theo ngày 540 phút | Seed đặt 1 / 2 / 5 / 10 ngày làm việc theo ngày 480 phút |
| Xem ticket | `relatedTicketIds` / `duplicateOf` trong chi tiết lộ id ticket người xem không được thấy | Chỉ trả id ticket xem được |
| Xem ticket | Tìm theo từ khoá khớp SĐT / tên khách của ticket hạn chế đã đóng → dò được SĐT | Người không có `view_restricted` không khớp khách ở loại ticket đó |
| Xem ticket | Đóng "Trùng": 400 / 404 cho biết ticket ẩn có tồn tại và trùng SĐT hay không | Kiểm tra quyền xem ticket đang đóng trước |
| Xem ticket | Tạo ticket liên kết tới id không tồn tại / không xem được | Kiểm tra tồn tại và quyền xem, tối đa 20 |
| Xem ticket | Huy hiệu tổng vẫn cộng tab "Chưa ai nhận" với nhân viên thường | Tab này chỉ tính khi `canViewAll` |
| Xem ticket | Tab "Ticket của tôi" bỏ sót ticket giao riêng đang chờ bổ sung / tạm hoãn | Lấy mọi trạng thái chưa đóng / huỷ |
| Xem ticket | Trưởng phòng không có dòng thành viên ở phòng mình quản lý không nhận / thấy ticket giao cho phòng | `departmentIds` tính cả phòng làm trưởng (khớp `colleagueIds`) |
| Thông báo | Huỷ ticket không báo ai; mở lại / trả về hàng chờ không báo người chờ nhận | `cancelled` báo nhóm xử lý / người được giao / trưởng phòng; `reopened_unclaimed`, `returned_to_queue_unclaimed` báo người đang chờ nhận |
| Thông báo | Người phụ trách / người được @nhắc không mở được ticket vẫn nhận (link chết, lộ tiêu đề / nội dung) | `recipientsWithTicketAccess` lọc người nhận theo quyền xem (trừ thông báo "không còn xử lý" cho người bị gỡ) |
| Thông báo | Người vừa được giao đích danh lúc tạo nhận cả "ticket mới" lẫn "được giao" | Bỏ người được giao khỏi thông báo "ticket mới" |
| Tờ trình | Web coi tờ trình đã nộp nếu bất kỳ ai tải lên, backend chỉ tính file của người tạo | Chi tiết trả `uploadedById`; web chỉ tính file của người tạo |
| Bổ sung | Backend không bắt nhập nội dung với mục `input: "text"` | `submitInfo` trả 400 nếu thiếu nội dung |
| Dữ liệu | `note`, `reason`, `description`... không phải chuỗi gây 500 | `readPayload` trả 400 |
| Dữ liệu | Sửa ticket sang sản phẩm / loại đã tắt | Chặn như lúc tạo (giữ nguyên giá trị cũ vẫn được) |
| Mã lỗi | Nhắn tin vào ticket đã kết thúc trả 403 | 409 `INVALID_STATUS_TRANSITION` như các thao tác khác |
| Web | Hộp thoại gửi `version` lúc bấm lưu nên ghi đè âm thầm thay đổi của người khác | Chốt `version` lúc mở hộp thoại (409 như thiết kế) |
| Web | So khớp mã app phân biệt hoa thường | So khớp không phân biệt |
| Web | `/ticket-ho-tro/...` mở bởi người không có quyền CRM → về dashboard, mất ticket | Chuyển sang `/workplace/tickets/...` |
| Web | Đổi sản phẩm vẫn lưu giá trị trường đã ẩn; nhân bản ticket không chuyển sang ticket mới; tab "Chưa ai nhận" nháy; dòng ticket không mở tab mới bằng Ctrl+click | Đã sửa |
| Hạ tầng | Ngày lễ chỉ nạp từ 7 ngày trước | 30 ngày |

**Chưa đổi (quyết định cần chủ hệ thống):**

- **Ngày 480 phút trên khung 08:00–17:00 (540 phút, chưa trừ nghỉ trưa):** "3 ngày làm việc" (tự đóng / mở lại) ngắn hơn khoảng 6 giờ so với 3 ngày thực. Muốn chính xác cần hỗ trợ giờ nghỉ trong `WorkingCalendar` hoặc đặt `workday_minutes = 540`.
- **Chạy lại `seedPermissionAll` trên production ghi đè `grants` của mọi role hệ thống** (kể cả chỉnh tay ở màn Phân quyền) — chỉ chạy sau khi đối chiếu; sau seed phải chạy `invalidateAllPermissionCache` (cache quyền không có TTL).
- **Sự kiện thông báo không bền** (EventEmitter2 trong tiến trình, không outbox): tiến trình chết ngay sau commit thì mất thông báo.
- **Tab "department" và `counts`:** mỗi request quét danh sách phòng ban 1–2 lần; `counts` chạy 6 truy vấn. Chưa tối ưu (chưa thấy chậm).
- **Lô cron 200 ticket:** một ticket lỗi mãi không phải lỗi version có thể chặn lô; chưa gặp.
