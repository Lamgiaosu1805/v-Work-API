# Hướng dẫn sử dụng chức năng Ticket hỗ trợ trên vWork

<!--
Nguồn: đọc luồng thực tế của vWork (backend `src/modules/ticket`, giao diện `src/features/ticket` + `src/pages/workplace/Ticket*Screen.jsx` của vWork-website), 11/2026.
Tài liệu này đồng thời là văn bản nạp cho Trợ lý Nội quy (xem docs/HANDBOOK-ASSISTANT.md, mục "Văn bản hướng dẫn ticket"):
  - mỗi "## Mục N. Tiêu đề" là một mục (đơn vị trích dẫn); mỗi đoạn hoặc dòng gạch đầu dòng / đánh số là một khối;
  - viết mỗi ý trên MỘT dòng và tự đứng được (không dựa vào dòng trước), vì trợ lý trích dẫn theo từng khối.
KHÔNG ghi cứng các con số cấu hình được (ngưỡng "Cần chú ý", số ngày tự đóng / mở lại, giờ làm việc, danh sách sản phẩm / mẫu):
trợ lý nhận các số đang áp dụng từ khối "Cấu hình Ticket hỗ trợ đang áp dụng trên vWork" (đọc DB lúc hỏi —
src/modules/ticket/application/ticket-guide-summary.service.ts). Ở đây chỉ mô tả luồng thao tác.
Khi vWork đổi luồng ticket thì sửa file này rồi nạp lại (scripts/handbook/build-guide-manifest.ts).
-->

## Mục 1. Ticket hỗ trợ dùng để làm gì và tìm ở đâu

Ticket hỗ trợ là chức năng trên vWork để gửi yêu cầu hỗ trợ, báo sự cố hoặc đề nghị thay đổi cần IT hoặc bộ phận vận hành xử lý, ví dụ lỗi trên app VNFITE, TIKLUY, lỗi CRM, khách quên mật khẩu, reset thiết bị, giao dịch bị treo, đổi số điện thoại của khách.
Ticket khác Đơn từ: Đơn từ chỉ được duyệt hoặc từ chối, còn ticket có người nhận xử lý, trao đổi, yêu cầu bổ sung, tạm hoãn và kết quả xử lý.
Mọi nhân viên đều tạo được ticket. Khách hàng không tự tạo ticket: khách báo qua fanpage, Sale hoặc CSKH, rồi Sale / CSKH vào vWork tạo ticket cho khách.
Người không có quyền CRM mở ticket ở phân hệ Workplace, menu "Công việc", mục "Ticket hỗ trợ".
Người có quyền CRM mở ticket ở phân hệ CRM, menu "CSKH & Call Center", mục "Ticket hỗ trợ". Link ticket gửi cho nhau hoặc bấm từ thông báo tự mở đúng nơi theo quyền của người mở.
Số trên mục "Ticket hỗ trợ" ở menu là số ticket cần bạn để ý; một ticket có thể nằm ở nhiều tab nên số này không phải tổng số ticket.
Chỉ người có quyền xử lý ticket (thường là IT và người được cấp quyền xử lý) mới nhận và xử lý được ticket; nhân viên khác tạo, theo dõi, trao đổi và bổ sung thông tin cho ticket của mình.

## Mục 2. Màn danh sách ticket: các tab và bộ lọc

Tab "Ticket của tôi": mọi ticket liên quan tới bạn (bạn tạo, bạn đang xử lý hoặc được giao riêng cho bạn), gồm cả ticket đã đóng. Các tab con: Tất cả, Đang mở, Tôi tạo, Tôi đang xử lý, Giao cho tôi. Số trên tab chỉ đếm ticket đang mở.
Tab "Cần tôi phản hồi": ticket bạn tạo đang chờ chính bạn, tức là đang "Chờ bổ sung" (cần bổ sung thông tin) hoặc "Đã xử lý" (cần xác nhận đã xong).
Tab "Chưa ai nhận": ticket chưa giao cho ai và chưa có người nhận. Tab này chỉ hiện với người xử lý và người quản lý ticket; nhân viên thường không thấy tab này.
Tab "Ticket phòng ban": ticket của phòng bạn (gồm phòng con). Các tab con: Tất cả của phòng, Giao cho phòng, chờ nhận, Phòng đang xử lý, Do phòng tạo.
Tab "Cần chú ý": ticket có nguy cơ bị bỏ quên (chưa ai nhận quá lâu, lâu không có cập nhật, quá ngày dự kiến, tạm hoãn lâu chưa cập nhật), xếp theo mức bị bỏ quên lâu nhất (xem Mục 13).
Tab "Tất cả": mọi ticket bạn được xem, kể cả ticket đã đóng hoặc đã huỷ; lọc theo trạng thái ở ô "Trạng thái".
Bộ lọc: ô tìm "Tìm theo mã, tiêu đề, SĐT / tên khách...", các ô Sản phẩm, Loại yêu cầu, Mức khẩn, Trạng thái, Từ ngày, Đến ngày; bấm "Xoá bộ lọc" để bỏ lọc.
Danh sách nhóm theo ngày tạo (Hôm nay, Hôm qua, rồi từng ngày), mới nhất ở trên. Mỗi dòng có mã ticket (dạng TK-...), tiêu đề, sản phẩm, loại yêu cầu, khách hàng, người xử lý, trạng thái và mức khẩn.
Có thể thao tác ngay trên dòng ticket mà không cần mở chi tiết: bấm chip trạng thái (màn rộng) hoặc nút chính và menu "⋮" (màn hẹp) để Nhận xử lý, Báo đã xử lý xong, Xác nhận đã xong, Mở lại, Huỷ yêu cầu... Việc gửi bổ sung, thêm người phối hợp, liên kết ticket và sửa thông tin thì làm ở màn chi tiết.

## Mục 3. Các bước tạo một ticket

Bước 1: mở "Ticket hỗ trợ", bấm nút "Tạo ticket" ở góc trên. Form "Tạo ticket hỗ trợ" mở ra.
Bước 2: ở ô "Sản phẩm*" chọn nơi xảy ra lỗi hoặc cần hỗ trợ (ví dụ VNFITE APP, TIKLUY APP, CRM, HRM...).
Bước 3: ở ô "Loại yêu cầu*" chọn loại yêu cầu; nếu có mẫu phù hợp thì chọn dòng mẫu thụt vào bên dưới loại đó để form tự điền sẵn (xem Mục 4). Không có mẫu phù hợp thì chỉ chọn loại và tự mô tả.
Bước 4: điền khách hàng (sản phẩm app VNFITE / TIKLUY) hoặc nhân sự liên quan (sản phẩm nội bộ CRM / HRM / Workplace) nếu có (xem Mục 6).
Bước 5: điền các trường ở phần "Thông tin theo mẫu" nếu đã chọn mẫu; trường có dấu * là bắt buộc.
Bước 6: nhập "Tiêu đề*" ngắn gọn để người xử lý nhìn là hiểu; chọn mẫu thì tiêu đề được gợi ý sẵn và vẫn sửa được. Nhập "Mô tả": chuyện gì đã xảy ra, đang làm gì hoặc bấm nút nào, kết quả mong đợi, kết quả thực tế (chép nguyên văn thông báo lỗi nếu có), thời điểm xảy ra, khách đã thử gì.
Bước 7: chọn "Mức khẩn" (Khẩn, Cao, Bình thường, Thấp); mặc định là Bình thường. Khi đã chọn mẫu thì mức khẩn theo mẫu và không đổi được trên form (xem Mục 5).
Bước 8: ở phần "Đính kèm" tải ảnh chụp màn hình, video lỗi và các giấy tờ mẫu yêu cầu (xem Mục 6).
Bước 9: bấm "Tạo ticket". Ticket mới ở trạng thái "Mới" và người phụ trách loại việc đó nhận thông báo; màn hình chuyển sang chi tiết ticket vừa tạo.
Nếu mẫu bắt buộc tờ trình mà bạn chưa đính kèm tờ trình thì ticket vẫn được tạo nhưng ở trạng thái "Chờ bổ sung" cho tới khi bạn tải tờ trình lên (xem Mục 10).
Trưởng bộ phận và ban lãnh đạo thấy thêm khối "Giao việc" trên form để giao ngay cho người hoặc phòng ban; người khác bỏ qua phần này (xem Mục 8).
Không ghi mật khẩu của khách hay của tài khoản nào vào tiêu đề, mô tả hoặc trao đổi trong ticket.

## Mục 4. Sản phẩm, loại yêu cầu và mẫu yêu cầu

Sản phẩm cho biết lỗi ở đâu, loại yêu cầu cho biết đây là việc gì (ví dụ Lỗi / sự cố, Hỗ trợ tài khoản khách, Giao dịch & lãi, Thay đổi thông tin khách, Quyền & tài khoản nội bộ, Thiết bị & mạng, Đề xuất tính năng, Hỏi đáp, Khác).
Danh sách sản phẩm, loại yêu cầu và mẫu yêu cầu do người quản trị ticket cấu hình và có thể thay đổi; danh sách đang dùng xem trên form tạo ticket.
Mẫu yêu cầu dành cho các việc hay gặp. Chọn mẫu thì form tự hiện các trường cần điền, giấy tờ cần đính kèm, tiêu đề gợi ý, mức khẩn của mẫu và phần hướng dẫn của mẫu (khung màu xanh).
Các mẫu thường gặp: Lỗi hệ thống (CRM báo lỗi, thao tác không chạy), Hồ sơ vay đang xử lý bị vướng, Quên mật khẩu / bị khoá đăng nhập, Reset thiết bị, Không cộng lãi / sai lãi, Rút / nạp tiền bị treo, Mở khoá / làm lại eKYC, Đổi số điện thoại, Tất toán trước hạn (ngoại lệ), Tăng lãi / ngoại lệ về luồng, tiền. Mẫu nào đang dùng và cần thông tin gì thì theo cấu hình hiện hành.
Đọc phần hướng dẫn của mẫu trước khi gửi: nhiều việc khách tự làm được trên app (ví dụ tự đặt lại mật khẩu bằng SĐT, số CCCD và OTP; tự reset thiết bị trên app VNFITE; tự tất toán trên app TIKLUY khi đủ điều kiện). Chỉ tạo ticket khi khách không tự làm được.
Trước khi gửi ticket báo lỗi hệ thống hoặc hồ sơ bị vướng, hãy tự kiểm tra: đã làm mới trang (F5) và đăng nhập lại chưa, đã chọn đúng hồ sơ và đúng bước chưa, việc cần làm có phải là một nút có sẵn trên hồ sơ không.
Không dùng ticket cho các thao tác đã có nút sẵn trên hồ sơ (Chờ bổ sung, Trả về, Đóng hồ sơ...), và không dùng ticket để xin ngoại lệ SLA hoặc điều chỉnh dữ liệu loại trừ SLA.
Mã khoản đầu tư của TIKLUY có dạng VNF + 13 chữ số và là mã khách thấy trên app; đừng nhầm với số tài khoản VNF.
Các mẫu Đổi số điện thoại, Tất toán trước hạn (ngoại lệ), Tăng lãi / ngoại lệ về luồng, tiền bắt buộc có tờ trình có chữ ký (xem Mục 10), trừ khi cấu hình hiện hành ghi khác.

## Mục 5. Mức khẩn

Ticket có 4 mức khẩn: Khẩn, Cao, Bình thường, Thấp.
Khẩn: nhiều khách bị ảnh hưởng hoặc tiền của khách có rủi ro. Cao: một khách bị chặn không dùng được dịch vụ hoặc giao dịch bị treo. Bình thường: việc thông thường. Thấp: không gấp, ví dụ đề xuất, câu hỏi.
Mức càng gấp thì ticket càng sớm bị đánh dấu "Cần chú ý" nếu chưa ai nhận hoặc lâu không có cập nhật; mốc cụ thể của từng mức theo cấu hình đang áp dụng.
Mức khẩn không phải hạn chót cứng: ticket không bị phạt vì quá số ngày của mức, chỉ bị bôi vàng "Cần chú ý" khi có dấu hiệu bị bỏ quên (xem Mục 13).
Khi chọn mẫu, mức khẩn theo mẫu và không đổi được trên form tạo. Sau khi tạo, người tạo và nhóm xử lý vẫn đổi được mức khẩn bằng "Sửa thông tin".
Người tạo đổi mức khẩn thì không bắt buộc ghi lý do; nhóm xử lý đổi mức khẩn thì bắt buộc ghi lý do.
Ticket mức Khẩn hoặc Cao vừa tạo được báo cho cả danh sách người phụ trách mặc định ngoài người phụ trách của mẫu, loại yêu cầu và sản phẩm.
Ticket chưa ai nhận mà được nâng lên Khẩn hoặc Cao thì người phụ trách nhận lại thông báo "Ticket được nâng lên mức ...".

## Mục 6. Khách hàng, nhân sự liên quan và file đính kèm

Với sản phẩm app (VNFITE, TIKLUY), phần "Khách hàng (không bắt buộc)" cho tìm khách trong CRM: gõ SĐT hoặc tên (từ 3 ký tự) rồi chọn khách trong danh sách.
Không tìm thấy khách hoặc bạn không có quyền xem khách trong CRM thì cứ nhập SĐT khách (và tên nếu muốn); ticket lưu theo SĐT đó và được đánh dấu "Khách chưa có trong CRM".
Đổi sang sản phẩm thuộc app khác thì liên kết khách CRM bị bỏ, cần chọn lại khách.
Với sản phẩm nội bộ (CRM, HRM, Workplace), phần "Nhân sự liên quan (không bắt buộc)" cho chọn nhân viên cần được hỗ trợ (gõ tên, mã nhân viên hoặc SĐT). Bỏ trống nếu người cần hỗ trợ là chính bạn.
Số điện thoại khách hiện đầy đủ trong ticket để người xử lý thao tác.
File đính kèm nhận các định dạng .jpg, .jpeg, .png, .webp, .gif, .heic, .pdf, .doc, .docx, .xls, .xlsx, .txt, .mp4, .mov; mỗi file tối đa 25MB.
Mỗi lần gửi đính kèm tối đa 10 file; trên form tạo ticket tối đa 5 ảnh / video lỗi. Có thể kéo thả hoặc dán ảnh (Ctrl+V) vào phần đính kèm.
Mỗi file có một loại: Ảnh / video lỗi, CCCD 2 mặt, Chứng từ giao dịch, Tờ trình có chữ ký, Giấy tờ nhạy cảm khác, Tài liệu khác. Hệ thống tự đoán loại theo đuôi file, đổi lại nếu cần.
CCCD, chứng từ giao dịch, tờ trình và giấy tờ nhạy cảm khác là file nhạy cảm: chỉ người tạo và nhóm xử lý (khi ticket chưa kết thúc) cùng người có quyền xem file nhạy cảm mới mở được.
Người không có quyền xem file nhạy cảm chỉ thấy một dòng thông tin (loại giấy tờ, người tải, thời gian) với ghi chú "Bạn không còn quyền xem file này", không thấy tên file.
File đính kèm của ticket không bị xoá; file chỉ tải được từ trong ticket, theo đúng quyền xem.

## Mục 7. Trạng thái của ticket

Ticket có 7 trạng thái: "Mới", "Đang xử lý", "Chờ bổ sung", "Tạm hoãn", "Đã xử lý", "Đã đóng", "Đã huỷ".
"Mới": chưa có người nhận xử lý (có thể đã được giao cho phòng ban hoặc người cụ thể nhưng chưa ai nhận).
"Đang xử lý": đã có người chủ trì nhận và đang xử lý.
"Chờ bổ sung": nhóm xử lý cần người tạo bổ sung thông tin, giấy tờ hoặc tờ trình; ticket đang chờ người tạo.
"Tạm hoãn": đang chờ bên khác (dev phát hành bản sửa, ngân hàng, đối tác...), có lý do và có thể có ngày dự kiến tiếp tục.
"Đã xử lý": nhóm xử lý đã báo xong, chờ người tạo xác nhận; người tạo không phản hồi thì hệ thống tự đóng sau một số ngày làm việc theo cấu hình.
"Đã đóng": ticket kết thúc kèm một kết quả. "Đã huỷ": người tạo đã rút yêu cầu.
Kết quả khi đóng gồm: "Đã giải quyết", "Không giải quyết", "Chưa đủ cơ sở" (đã xem xét nhưng không đủ căn cứ để thực hiện), "Không phải lỗi" (hệ thống chạy đúng nghiệp vụ), "Trùng" (trùng với một ticket khác của cùng khách, cùng sự việc), "Người tạo không bổ sung" (hệ thống tự đóng khi người tạo không bổ sung trong hạn).
Luồng thường gặp: Mới → (có người nhận) Đang xử lý → (báo xong) Đã xử lý → (người tạo xác nhận hoặc hệ thống tự đóng) Đã đóng.
Từ "Đang xử lý", nhóm xử lý có thể chuyển sang "Chờ bổ sung" hoặc "Tạm hoãn" rồi quay lại "Đang xử lý", hoặc đóng ngay với một kết quả.
Mọi lần đổi trạng thái, giao việc, sửa thông tin đều được ghi trong thẻ "Lịch sử" ở màn chi tiết, kèm người làm, thời gian và ghi chú.

## Mục 8. Ai nhận ticket, giao việc, chủ trì và phối hợp

Ticket không giao cho ai: mọi người có quyền xử lý ticket đều thấy và bấm "Nhận xử lý" được. Người phụ trách loại việc đó chỉ nhận thông báo, không độc quyền nhận.
Ticket giao cho phòng ban: thành viên phòng đó (kể cả phòng con) tự nhận ở tab "Ticket phòng ban", hoặc trưởng phòng giao tiếp cho người cụ thể.
Ticket giao cho người cụ thể: chỉ những người được giao mới nhận được.
Người bấm "Nhận xử lý" đầu tiên trở thành chủ trì. Nếu người khác đã nhận trước thì hệ thống báo "... đã nhận xử lý ticket này"; muốn cùng làm thì nhắn trong phần trao đổi để người trong nhóm thêm bạn vào làm người phối hợp.
Nhóm xử lý gồm 1 người chủ trì và không giới hạn người phối hợp. Ai trong nhóm cũng đổi trạng thái, yêu cầu bổ sung, tạm hoãn, báo xong, đóng ticket, đặt ngày dự kiến và thêm người phối hợp được.
Chủ trì chỉ khác người phối hợp ở chỗ là đầu mối: tên hiện ở danh sách và nhận thông báo thay cả nhóm (người tạo bổ sung xong, người tạo sửa nội dung, tới ngày kiểm tra).
Khi giao cho nhiều người, người giao có thể chọn sẵn chủ trì; bỏ trống thì người đầu tiên bấm "Nhận xử lý" là chủ trì và những người còn lại tự động là người phối hợp.
Ban lãnh đạo (và IT được cấp quyền) giao được cho phòng ban hoặc người cụ thể. Trưởng bộ phận chỉ giao được cho người trong phòng mình (kể cả phòng con); muốn nhờ phòng khác thì tạo ticket để bên đó tự nhận.
Chỉ giao hoặc mời phối hợp được người có quyền xử lý ticket; nếu không, hệ thống báo "Chưa có quyền xử lý ticket (cần gán role người xử lý ticket): <tên>".
Thêm phối hợp: người trong nhóm bấm "Thêm phối hợp" và chọn người ở bất kỳ phòng ban nào; người được thêm nhận thông báo. Người ngoài nhóm không tự vào nhóm được.
Rời nhóm: người phối hợp bấm dấu x trên tên của mình ở thẻ "Người xử lý" (mục Nhóm xử lý); người trong nhóm cũng bỏ người phối hợp ra bằng dấu x. Thao tác thực hiện ngay, không hỏi lại.
Chủ trì bấm "Trả lại" (bắt buộc ghi lý do) khi không xử lý tiếp: người phối hợp được thêm sớm nhất thành chủ trì; không còn ai thì ticket quay về "Mới" để người khác nhận.
Giao lại một ticket đang có người xử lý thì nhóm xử lý cũ bị thay; người bị gỡ nhận thông báo "Bạn không còn xử lý ticket này".

## Mục 9. Yêu cầu bổ sung và cách bổ sung thông tin

Người trong nhóm xử lý bấm "Yêu cầu bổ sung", tích các mục còn thiếu và ghi chú thêm nếu cần, rồi bấm "Gửi yêu cầu". Ticket chuyển sang "Chờ bổ sung" và người tạo nhận thông báo "Cần bổ sung thông tin cho ticket".
Các mục có thể yêu cầu: Mô tả rõ hơn, Ảnh/video chụp lỗi, Các bước tái hiện lỗi, Số điện thoại khách, Số CCCD của khách, CCCD 2 mặt, Xác nhận của khách (tin nhắn/ghi âm đồng ý), Mã khoản đầu tư / khoản vay, Chứng từ (sao kê, UNC, ảnh chuyển khoản, mã giao dịch), Số tiền và thời điểm, Căn cứ áp dụng (số QĐ, chính sách), Tờ trình có chữ ký, Khác (ghi rõ).
Người tạo xem các mục cần bổ sung ở khung "Chờ người tạo bổ sung" trong thẻ "Thông tin" của ticket, hoặc ở tab "Cần tôi phản hồi".
Cách bổ sung: mở ticket, bấm "Gửi bổ sung", nhập "Nội dung bổ sung", đính kèm file nếu cần rồi bấm "Gửi bổ sung". Nội dung bổ sung được lưu thành tin nhắn trong phần trao đổi.
Ô "Nội dung bổ sung" bắt buộc nhập khi người xử lý hỏi mục chỉ trả lời được bằng chữ (mô tả, các bước tái hiện, SĐT, số CCCD, mã khoản đầu tư / vay, số tiền và thời điểm, căn cứ áp dụng); mục chỉ cần file thì có thể chỉ đính kèm.
Bổ sung xong, ticket tự quay về "Đang xử lý" và chủ trì nhận thông báo; ticket chưa có chủ trì thì quay về "Mới" và người phụ trách được báo "Ticket đã đủ thông tin, chờ nhận".
Không bổ sung trong hạn thì người tạo được nhắc 1 lần trước khi hết hạn, rồi hệ thống tự đóng ticket với kết quả "Người tạo không bổ sung"; số ngày làm việc theo cấu hình đang áp dụng.
Mục "Khác" khi yêu cầu bổ sung phải ghi rõ cần bổ sung gì.

## Mục 10. Tờ trình

Một số việc cần tờ trình có chữ ký mới được thực hiện, ví dụ đổi số điện thoại của khách, tất toán trước hạn ngoại lệ, tăng lãi hoặc ngoại lệ về luồng, tiền. Người xử lý cũng có thể yêu cầu tờ trình cho ticket khác khi thấy chưa đủ cơ sở.
Hiện tại tờ trình chưa được duyệt điện tử trên vWork: tờ trình được duyệt qua email, người tạo tải ảnh hoặc PDF tờ trình đã ký lên ticket.
Cách nộp: khi tạo ticket theo mẫu cần tờ trình, chọn file ở dòng "Tờ trình có chữ ký" (nút "Chọn file tờ trình (từ email)") và nhập "Số tờ trình", "Ngày tờ trình", "Người ký" nếu có; hoặc khi ticket "Chờ bổ sung" mục tờ trình, bấm "Gửi bổ sung" và tải tờ trình lên.
Chưa có tờ trình thì ticket ở "Chờ bổ sung" cho tới khi người tạo tải lên. Chỉ file tờ trình do chính người tạo tải lên mới được tính.
Ticket cần tờ trình là ticket hạn chế: chỉ người liên quan và người có quyền mới xem được (xem Mục 14).
Sau khi nộp, người trong nhóm xử lý hoặc người có quyền xem ticket hạn chế bấm "Tờ trình hợp lệ" hoặc "Tờ trình không hợp lệ". Người tạo ticket không tự xác nhận tờ trình của mình.
Tờ trình không hợp lệ (thiếu chữ ký, sai nội dung...) thì ticket quay về "Chờ bổ sung" kèm lý do để người tạo nộp lại.
Chưa có tờ trình hợp lệ thì nhóm xử lý không báo xong và không đóng ticket với kết quả "Đã giải quyết" được.
Trạng thái tờ trình hiện ở thẻ "Tờ trình": Chưa có tờ trình, Đã nộp, chờ xác nhận, Tờ trình hợp lệ, Tờ trình không hợp lệ.

## Mục 11. Trao đổi, nhắc tên và thông báo

Phần "Trao đổi" ở màn chi tiết dùng để nhắn giữa người tạo và nhóm xử lý. Enter để gửi, Shift + Enter để xuống dòng; có thể đính kèm file.
Gõ @ hoặc bấm "@ Nhắc tên" để nhắc tên đồng nghiệp; người được nhắc nhận thông báo "Bạn được nhắc tên trong ticket ...". Đây là cách mời người ngoài nhóm vào xem và góp ý.
Khi gửi giấy tờ cá nhân trong trao đổi, tích ô "Tệp nhạy cảm" để chỉ người có quyền xem file nhạy cảm mới mở được.
Ticket đã đóng hoặc đã huỷ thì không trao đổi thêm được.
Thông báo ticket hiện ở biểu tượng chuông trên vWork và trên app (nếu có); bấm thông báo để mở đúng ticket. Người tự làm thao tác không nhận thông báo của chính mình.
Người tạo nhận thông báo khi: ticket được giao cho ai, có người nhận xử lý, cần bổ sung thông tin, ticket tạm hoãn hoặc tiếp tục, ticket quay về hàng chờ nhận, ticket đã xử lý (cần xác nhận), ticket đã đóng hoặc tự đóng, và khi có tin nhắn mới.
Nhóm xử lý nhận thông báo khi: được giao hoặc được thêm vào nhóm, người tạo bổ sung xong, người tạo sửa nội dung, ticket được mở lại, có tin nhắn mới, và khi tới ngày kiểm tra "Cần theo dõi thêm" (chủ trì).
Người phụ trách loại việc nhận thông báo khi có ticket mới cần nhận, ticket chưa ai nhận được nâng mức khẩn, và ticket Khẩn / Cao chưa ai nhận đã bị đánh dấu "Cần chú ý" (nhắc 1 lần).
Không có bản tin tổng hợp hằng ngày và không có chức năng theo dõi (follow) ticket.

## Mục 12. Xác nhận đã xong, tự đóng, mở lại, huỷ và tạo ticket mới từ ticket cũ

Khi nhóm xử lý báo xong, ticket chuyển sang "Đã xử lý" và người tạo nhận thông báo "Ticket đã xử lý, vui lòng xác nhận".
Người tạo kiểm tra lại; nếu đã ổn thì bấm "Xác nhận đã xong". Ticket đóng với kết quả "Đã giải quyết" và sau khi xác nhận thì không mở lại được nữa.
Nếu chưa ổn, người tạo bấm "Mở lại" và ghi lý do (vẫn chưa ổn ở chỗ nào); ticket quay về "Đang xử lý" và chủ trì được báo.
Người tạo không phản hồi thì hệ thống tự đóng ticket "Đã xử lý" với kết quả "Đã giải quyết" sau một số ngày làm việc theo cấu hình; ticket có đánh dấu "Cần theo dõi thêm" không tự đóng trước ngày kiểm tra.
Ticket đã đóng mà người tạo chưa bấm xác nhận (do nhóm xử lý đóng hoặc hệ thống tự đóng) thì người tạo hoặc nhóm xử lý mở lại được trong hạn theo cấu hình, tính bằng ngày làm việc kể từ lúc đóng; hạn mở lại hiện ở thẻ "Thông tin".
Quá hạn mở lại, ticket đã được người tạo xác nhận, hoặc ticket đã huỷ thì không mở lại được; hãy dùng nút "Tạo ticket mới từ ticket này".
"Tạo ticket mới từ ticket này" mở form tạo ticket đã điền sẵn sản phẩm, loại, mẫu, tiêu đề, mô tả, mức khẩn, khách hàng và tự liên kết với ticket cũ; file đính kèm không được chép, cần đính kèm lại.
Huỷ yêu cầu: người tạo bấm "Huỷ yêu cầu" và ghi lý do (tạo nhầm, khách tự làm được...). Chỉ huỷ được khi ticket đang "Mới" hoặc "Chờ bổ sung"; ticket đang được xử lý thì nhắn nhóm xử lý để họ đóng.
"Xác nhận đã xong" khác "Huỷ": xác nhận là đồng ý việc đã được xử lý xong; huỷ là rút yêu cầu trước khi được xử lý.
Sửa ticket: người tạo sửa được tiêu đề, mô tả, sản phẩm, loại yêu cầu, mức khẩn bằng nút "Sửa thông tin" khi ticket đang Mới, Đang xử lý, Chờ bổ sung hoặc Tạm hoãn. Nhóm xử lý sửa được sản phẩm, loại yêu cầu, mức khẩn. Mọi lần sửa đều lưu nội dung cũ và mới trong lịch sử.
Ticket đã đóng hoặc đã huỷ thì không sửa được.

## Mục 13. Cần chú ý (bôi vàng) thay cho SLA

Ticket không có hạn chót cứng (SLA). Thay vào đó, ticket có dấu hiệu bị bỏ quên sẽ bị bôi vàng trên giao diện cho mọi người thấy và hiện ở tab "Cần chú ý".
Có 4 lý do bị bôi vàng: "Lâu chưa có ai nhận" (ticket Mới quá ngưỡng chưa ai nhận), "Lâu chưa có cập nhật" (ticket Đang xử lý không có hoạt động nào quá ngưỡng), "Đã quá ngày dự kiến" (quá ngày dự kiến xong do nhóm xử lý tự đặt, hoặc quá ngày dự kiến tiếp tục khi tạm hoãn), "Tạm hoãn lâu chưa cập nhật" (tạm hoãn không có ngày dự kiến tiếp tục và lâu không cập nhật).
Ngưỡng của từng lý do phụ thuộc mức khẩn và theo cấu hình đang áp dụng; thời gian chỉ tính trong giờ làm việc, không tính ngày nghỉ và ngày lễ.
Ticket đang "Chờ bổ sung" hoặc "Đã xử lý" (đang chờ người tạo) không bị bôi vàng, vì đã có cơ chế tự đóng riêng.
Có hoạt động mới (trao đổi của nhóm xử lý, đổi trạng thái, cập nhật) thì ticket hết vàng. Tin nhắn của người tạo không làm hết vàng.
Nhóm xử lý có thể bấm "Đặt ngày dự kiến" khi nhận việc lớn; trước ngày đó ticket không bị vàng vì lâu không cập nhật. Dời ngày dự kiến phải ghi lý do và số lần dời hiện trên ticket.
Tạm hoãn không có ngày dự kiến thì chỉ cần ghi một dòng cập nhật (ví dụ "vẫn chờ ngân hàng phản hồi") là ticket hết vàng.
Bôi vàng không gửi thông báo cho ai, trừ ticket Khẩn hoặc Cao chưa ai nhận: người phụ trách được nhắc 1 lần mỗi khi ticket đó bị bôi vàng.

## Mục 14. Ai xem được ticket nào

Nhân viên thường xem được ticket do mình tạo, ticket do người cùng phòng (kể cả phòng con) tạo, và ticket mình được giao hoặc tham gia xử lý.
Người có quyền xử lý ticket, người có quyền giao việc cho phòng ban và người quản lý ticket xem được mọi ticket thường của công ty.
Ticket hạn chế (ticket cần tờ trình hoặc được đánh dấu hạn chế) có nhãn "Hạn chế": chỉ người tạo, nhóm xử lý, người được giao đang chờ nhận và người có quyền xem ticket hạn chế mới thấy; người khác không thấy ticket này trong danh sách.
Ticket hạn chế đã đóng: người tạo chỉ còn xem thông tin chung (mã, tiêu đề, trạng thái, kết quả, ghi chú kết luận, hạn mở lại) và nút "Mở lại" nếu còn hạn; không còn xem file, tờ trình và phần trao đổi.
Người đã trả lại ticket hoặc bị gỡ khỏi nhóm xử lý thì không còn xem ticket hạn chế và file nhạy cảm của ticket đó.
Mã khách (User ID trên app) chỉ hiện cho nhóm xử lý, IT và người quản lý ticket; người có quyền xem khách trong CRM bấm được vào tên khách để mở hồ sơ khách.
Không có quyền xem một ticket mà mở link ticket đó thì hệ thống báo không tìm thấy ticket.

## Mục 15. Hướng dẫn cho người xử lý ticket

Nhận việc: ở tab "Chưa ai nhận", "Ticket phòng ban" hoặc từ thông báo, bấm "Nhận xử lý". Bạn thành chủ trì và người tạo nhận thông báo đã có người nhận.
Đặt ngày dự kiến xong (không bắt buộc): bấm "Đặt ngày dự kiến" để báo cho mọi người và tránh bị bôi vàng vì lâu không cập nhật trước ngày đó.
Tạm hoãn: khi chờ bên khác, bấm "Tạm hoãn", ghi "Lý do tạm hoãn" (bắt buộc) và "Ngày dự kiến tiếp tục" nếu biết; khi có kết quả thì bấm "Tiếp tục xử lý". Người tạo được báo cả hai lần.
Báo đã xử lý xong: bấm "Báo đã xử lý xong", ghi kết quả / ghi chú (đã xử lý thế nào, có vấn đề gì phát sinh) và ô "Đã làm gì, trên hệ thống nào, cho khách hàng hoặc nhân viên nào" (không bắt buộc), rồi bấm "Báo xong". Ticket chuyển sang "Đã xử lý" chờ người tạo xác nhận.
Nên ghi rõ đã làm gì vào ô "Đã làm gì...", vì hệ thống quản trị của app (CMS) không ghi lại ai đã reset mật khẩu, reset thiết bị hay mở khoá; ticket là nơi còn dấu vết.
Cần theo dõi thêm: khi báo xong, tích "Cần theo dõi thêm sau khi xử lý", ghi "Cần theo dõi gì" và "Ngày kiểm tra"; ticket không tự đóng trước ngày đó và chủ trì được nhắc 1 lần khi tới ngày.
Đóng ticket với kết quả khác: bấm "Đóng ticket" và chọn kết quả. "Không giải quyết", "Chưa đủ cơ sở", "Không phải lỗi" bắt buộc ghi lý do; "Trùng" bắt buộc chọn ticket gốc.
Chỉ đánh "Trùng" khi cùng khách và cùng sự việc (ví dụ 2 Sale cùng tạo cho 1 khách). Cùng một lỗi nhưng khác khách thì dùng "Liên kết ticket liên quan" và xử lý, đóng riêng từng ticket; hệ thống chặn đánh trùng hai ticket khác số điện thoại khách.
Liên kết ticket liên quan: bấm "Liên kết ticket liên quan", gõ mã hoặc tiêu đề ticket để chọn; liên kết chỉ để tham chiếu, mỗi ticket vẫn xử lý và đóng riêng.
Trả lại: chủ trì không xử lý tiếp thì bấm "Trả lại" và ghi lý do (xem Mục 8).
Nhiều người trong nhóm cùng thao tác: nếu ticket vừa được người khác cập nhật, hệ thống báo "Ticket vừa được người khác cập nhật, vui lòng tải lại để xem" và tự tải lại; xem lại rồi thao tác tiếp.
Người có quyền quản lý ticket (ban lãnh đạo, trưởng IT) thao tác được như nhóm xử lý trên mọi ticket, kể cả đóng hộ ticket.
Không ghi mật khẩu (kể cả mật khẩu mới vừa đặt lại cho khách) vào ticket; gửi mật khẩu cho khách qua kênh riêng theo quy định.

## Mục 16. Các thông báo lỗi thường gặp

"Tiêu đề ticket không được để trống" hoặc "Vui lòng nhập tiêu đề ticket": nhập tiêu đề ngắn gọn cho ticket.
"Vui lòng chọn sản phẩm" hoặc "Vui lòng chọn loại yêu cầu": chọn đủ Sản phẩm và Loại yêu cầu trên form.
"Vui lòng nhập: ..." hoặc "Vui lòng đính kèm: ...": mẫu yêu cầu bắt buộc các trường hoặc giấy tờ được liệt kê; điền hoặc đính kèm đủ rồi gửi lại.
"Loại file ... không được phép đính kèm", "... vượt quá 25MB", "Chỉ đính kèm tối đa 10 file mỗi lần" hoặc "Chỉ đính kèm tối đa 5 ảnh / video lỗi": đổi sang định dạng được hỗ trợ, giảm dung lượng hoặc bớt số file.
"... đã nhận xử lý ticket này" hoặc "Ticket đã có người nhận xử lý": người khác đã nhận trước; nhắn trong phần trao đổi nếu muốn được thêm làm người phối hợp.
"Ticket này đã được giao cho người khác, bạn không thể nhận" hoặc "Ticket này đã được giao cho phòng ban khác": ticket đã giao đích danh hoặc giao cho phòng khác nên bạn không nhận được.
"Ticket vừa được người khác cập nhật, vui lòng tải lại để xem": ticket vừa thay đổi; hệ thống đã tải lại, xem lại rồi thao tác tiếp.
"Ticket không ở trạng thái phù hợp cho thao tác này": thao tác không áp dụng cho trạng thái hiện tại của ticket (ví dụ huỷ ticket đang được xử lý, nhắn vào ticket đã đóng).
"Ticket không thể mở lại, vui lòng tạo ticket mới" hoặc "Ticket đã huỷ, vui lòng tạo ticket mới": quá hạn mở lại, người tạo đã xác nhận, hoặc ticket đã huỷ; dùng "Tạo ticket mới từ ticket này".
"Ticket cần tờ trình hợp lệ trước khi kết luận đã giải quyết": cần người có thẩm quyền xác nhận "Tờ trình hợp lệ" trước khi báo xong hoặc đóng "Đã giải quyết".
"Vui lòng tải lên tờ trình có chữ ký trước khi gửi": ticket đang chờ tờ trình; đính kèm file tờ trình đã ký khi bấm "Gửi bổ sung".
"Vui lòng nhập nội dung bổ sung: ...": người xử lý hỏi thông tin dạng chữ; nhập vào ô "Nội dung bổ sung".
"Vui lòng nhập ghi chú cho thao tác này" hoặc "Vui lòng nhập lý do khi đóng ticket với kết quả này": thao tác bắt buộc ghi lý do (trả lại, tạm hoãn, huỷ, mở lại, tờ trình không hợp lệ, đổi mức khẩn của nhóm xử lý, đóng với kết quả khác "Đã giải quyết").
"Chỉ người tạo ticket mới ..." (huỷ, xác nhận, bổ sung): các thao tác này chỉ người tạo ticket làm được.
"Chỉ nhóm xử lý (chủ trì, phối hợp) mới thực hiện được thao tác này": bạn chưa thuộc nhóm xử lý của ticket.
"Trưởng bộ phận chỉ giao việc cho người trong phòng mình. Để nhờ phòng khác, hãy tạo ticket mới": trưởng bộ phận không giao chéo phòng; tạo ticket để phòng kia tự nhận.
"Chưa có quyền xử lý ticket (cần gán role người xử lý ticket): ...": người được giao hoặc được mời phối hợp chưa có quyền xử lý ticket; liên hệ người quản trị phân quyền để gán quyền.
"Hai ticket thuộc hai khách khác nhau nên không thể đánh dấu trùng...": dùng liên kết "Liên quan" và xử lý riêng từng khách.
"Bạn không có quyền thực hiện thao tác này trên ticket" hoặc trang báo không có quyền: tài khoản của bạn chưa có quyền cho thao tác hoặc ticket đó; liên hệ bộ phận IT nếu cần.

## Câu hỏi gợi ý

Tạo ticket hỗ trợ trên vWork như thế nào?
Ticket bị bôi vàng "Cần chú ý" nghĩa là gì?
Khách quên mật khẩu thì tạo ticket gì?
