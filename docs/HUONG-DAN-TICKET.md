# Hướng dẫn sử dụng chức năng Ticket hỗ trợ trên vWork

<!--
Nguồn: đọc luồng thực tế của vWork (backend `src/modules/ticket`, giao diện `src/features/ticket` + `src/pages/workplace/Ticket*Screen.jsx` của vWork-website), 11/2026; phần tình huống, ví dụ và câu hỏi thường gặp lấy từ tài liệu "Hướng dẫn gửi ticket hỗ trợ trên CRM" (bản đề xuất 19/10/2026, chỉ lấy phần khớp với luồng đã xây).
Tài liệu này đồng thời là văn bản nạp cho Trợ lý Nội quy (xem docs/HANDBOOK-ASSISTANT.md, mục "Văn bản hướng dẫn ticket"):
  - mỗi "## Mục N. Tiêu đề" là một mục (đơn vị trích dẫn); mỗi đoạn hoặc dòng gạch đầu dòng / đánh số là một khối;
  - viết mỗi ý trên MỘT dòng và tự đứng được (không dựa vào dòng trước), vì trợ lý trích dẫn theo từng khối;
  - KHÔNG viết "xem Mục N" (trợ lý sẽ đọc nguyên văn ra cho người dùng) và KHÔNG lặp một ý ở nhiều mục (tốn token và làm câu trả lời lặp).
KHÔNG ghi cứng các con số cấu hình được (ngưỡng "Cần chú ý", số ngày tự đóng / mở lại, giờ làm việc, danh sách sản phẩm / mẫu):
trợ lý nhận các số đang áp dụng từ khối "Cấu hình Ticket hỗ trợ đang áp dụng trên vWork" (đọc DB lúc hỏi —
src/modules/ticket/application/ticket-guide-summary.service.ts), và quyền của người đang hỏi từ dòng "Quyền Ticket hỗ trợ của người hỏi".
Ở đây chỉ mô tả luồng thao tác. GIỮ NGẮN: mỗi nghìn token ở đây cộng vào MỌI câu hỏi, và bản hiệu lực đã sát ngưỡng 100 nghìn token của prompt (đo bằng scripts/handbook/import-handbook.ts --count-tokens; mục tiêu dưới khoảng 14 nghìn token cho file này).
Khi vWork đổi luồng ticket thì sửa file này rồi nạp lại (scripts/handbook/build-guide-manifest.ts).
-->

## Mục 1. Ticket hỗ trợ là gì, ai tạo được và mở ở đâu

Ticket hỗ trợ là kênh chính thức trên vWork để cán bộ nhân viên báo lỗi, nhờ hỗ trợ hoặc đề nghị xử lý, thay cho nhắn tin hoặc gọi điện rời rạc. Mỗi vấn đề có một mã ticket (dạng TK-...), một người xử lý và một lịch sử.
Ví dụ: lỗi app VNFITE, TIKLUY, lỗi CRM, hồ sơ vay bị vướng, khách quên mật khẩu hoặc cần reset thiết bị, giao dịch bị treo, đổi số điện thoại của khách.
Ticket khác Đơn từ: Đơn từ chỉ được duyệt hoặc từ chối, còn ticket có người nhận xử lý, trao đổi, yêu cầu bổ sung, tạm hoãn và kết quả xử lý.
Mọi nhân viên đều tạo được ticket (quyền có sẵn ở role Nhân viên cơ bản). Khách hàng không tự tạo ticket: khách báo qua fanpage, Sale hoặc CSKH, rồi Sale / CSKH tạo giúp.
Người có quyền vào CRM mở ticket ở CRM, menu "CSKH & Call Center", mục "Ticket hỗ trợ". Người không có quyền CRM mở ở Workplace, menu "Công việc", mục "Ticket hỗ trợ".
Số nhỏ cạnh mục "Ticket hỗ trợ" trên menu là số ticket cần bạn để ý (một ticket có thể nằm ở nhiều tab).
Hỏi Trợ lý về một ticket cụ thể: gõ mã ticket (dạng TK-...) kèm câu hỏi; trợ lý cho biết trạng thái, ai đang xử lý, đang chờ ai và bước tiếp theo, nhưng chỉ tra được ticket do chính bạn tạo, không tra ticket của người khác.

## Mục 2. Ai làm được gì (quyền)

Mọi nhân viên (role Nhân viên cơ bản): tạo ticket, xem ticket do mình hoặc người cùng phòng tạo, trao đổi, bổ sung thông tin, xác nhận đã xong, huỷ và mở lại ticket của mình.
Nhận và xử lý ticket (nhận, trả lại, tạm hoãn, báo xong, đóng, yêu cầu bổ sung) chỉ dành cho người có quyền xử lý, cấp qua một trong ba role: "Người xử lý ticket (đơn vị khác)" cho người của đơn vị khác được giao việc (Kế toán, QTRR, ĐVKD), "Nhân viên hỗ trợ ticket" cho IT, "Quản lý ticket hỗ trợ" cho trưởng IT.
Chưa có một trong ba role đó thì không thấy nút "Nhận xử lý"; muốn nhận ticket cần liên hệ bộ phận IT hoặc người quản trị phân quyền để được gán role.
Giao ticket cho phòng ban: ban lãnh đạo và Nhân viên hỗ trợ ticket. Giao cho người trong phòng: trưởng bộ phận (chỉ người trong phòng mình), ban lãnh đạo và Quản lý ticket hỗ trợ.
Quản lý ticket (đóng hộ, đổi chủ trì, sửa phân loại mọi ticket): ban lãnh đạo và Quản lý ticket hỗ trợ; ban lãnh đạo đóng hộ được nhưng không có nút "Nhận xử lý".
Xem ticket hạn chế và file nhạy cảm: ban lãnh đạo và IT. Màn "Cấu hình ticket": Quản lý ticket hỗ trợ.
Ngoài quyền, mỗi ticket có vai trò riêng: xác nhận đã xong, huỷ và bổ sung chỉ người tạo làm được; báo xong, tạm hoãn, đóng chỉ nhóm xử lý (hoặc người quản lý ticket).

## Mục 3. Khi nào nên gửi ticket và khi nào không

Gửi ticket khi đã thử thao tác bình thường mà hồ sơ hoặc chức năng vẫn không chạy đúng và không giải quyết được bằng nút có sẵn. Hai nhóm hay gặp tương ứng hai mẫu "Lỗi hệ thống" và "Hồ sơ vay đang xử lý bị vướng".
Lỗi hệ thống (CRM báo lỗi, thao tác không thực hiện được, hiển thị sai), ví dụ: hồ sơ đã duyệt nhưng không hiện ở Bước 1 của ĐVKD; bấm Chuyển thẩm định mà hồ sơ vẫn ở Bước 1; thiếu nút thao tác đúng bước.
Hồ sơ vay bị vướng giữa các bước cần IT thông hồ sơ, ví dụ: QTRR bấm Trả về ĐVKD nhưng ĐVKD không thấy hồ sơ; Kế toán bấm Đã giải ngân nhưng hồ sơ không sang Bước 9; bấm nhầm Đóng hồ sơ.
Không dùng ticket cho thao tác đã có nút trên hồ sơ (Chờ bổ sung, Trả về ĐVKD, Trả về thẩm định, Đóng hồ sơ) vì các nút này tự cập nhật trạng thái và đồng hồ SLA; hồ sơ thiếu tài liệu từ khách cũng dùng nút "Chờ bổ sung".
Không dùng ticket để xin ngoại lệ SLA (do Tổng Giám đốc hoặc người được uỷ quyền duyệt trước khi hết SLA chuẩn) hay điều chỉnh dữ liệu loại trừ SLA (chỉ Ban Chính sách sản phẩm được duyệt). Gửi ticket không tự dừng đồng hồ SLA; việc coi lỗi CRM là căn cứ loại trừ SLA chưa có quy định, cần hỏi lãnh đạo.
Bấm nhầm Đóng hồ sơ thì gửi ngay ticket Khẩn và báo trực tiếp cho IT; cách mở lại hồ sơ đã đóng chưa có quy định rõ, cần hỏi lãnh đạo.
Một lỗi ảnh hưởng nhiều hồ sơ thì gửi một ticket (điền một mã hồ sơ, liệt kê các mã còn lại trong mô tả); vấn đề riêng từng hồ sơ thì mỗi hồ sơ một ticket. Trước khi gửi nhớ làm mới trang (F5), đăng nhập lại và chọn đúng hồ sơ, đúng bước.

## Mục 4. Các bước tạo một ticket

Bước 1: mở "Ticket hỗ trợ", bấm "Tạo ticket".
Bước 2: chọn "Sản phẩm*" nơi xảy ra lỗi (ví dụ VNFITE APP, TIKLUY APP, CRM, HRM) và "Loại yêu cầu*"; có mẫu phù hợp thì chọn dòng mẫu thụt vào bên dưới loại để form tự điền sẵn, không có thì tự mô tả.
Bước 3: sản phẩm app (VNFITE, TIKLUY) chọn khách hàng, sản phẩm nội bộ (CRM, HRM, Workplace) chọn nhân sự liên quan nếu có (không bắt buộc); điền "Thông tin theo mẫu" (trường có dấu * bắt buộc), kể cả mã khoản đầu tư / khoản vay / mã hồ sơ nếu liên quan.
Bước 4: nhập "Tiêu đề*" một dòng nêu bước hoặc màn hình và hiện tượng (mẫu gợi ý sẵn, sửa được). "Mô tả" nên đủ bốn ý: đang làm gì, bấm nút nào; kết quả mong đợi; kết quả thực tế (chép nguyên văn thông báo lỗi); thời điểm xảy ra.
Bước 5: chọn "Mức khẩn" (mặc định Bình thường; có mẫu thì theo mẫu và không đổi được trên form) và đính kèm ảnh chụp toàn màn hình thấy rõ lỗi và giờ hệ thống, video ngắn, giấy tờ theo mẫu. Bấm "Tạo ticket": ticket ở trạng thái "Mới", người phụ trách nhận thông báo, không cần nhắn thêm cho IT trừ ticket Khẩn.
Mẫu bắt buộc tờ trình mà chưa đính kèm thì ticket vẫn được tạo nhưng ở "Chờ bổ sung" cho tới khi tải tờ trình lên. Trưởng bộ phận và ban lãnh đạo thấy thêm khối "Giao việc" để giao ngay.
Không ghi mật khẩu của khách hay của tài khoản nào vào tiêu đề, mô tả hoặc trao đổi trong ticket.

## Mục 5. Sản phẩm, loại yêu cầu và mẫu yêu cầu

Sản phẩm cho biết lỗi ở đâu, loại yêu cầu cho biết đây là việc gì; danh sách sản phẩm, loại và mẫu do người quản trị ticket cấu hình và có thể thay đổi. Chọn mẫu thì form hiện sẵn trường cần điền, giấy tờ cần đính kèm, tiêu đề gợi ý, mức khẩn và hướng dẫn của mẫu; đọc hướng dẫn của mẫu trước khi gửi vì nhiều việc khách tự làm được trên app.
Quên mật khẩu: khách tự đặt lại trên app bằng SĐT, số CCCD và OTP; làm không được mới tạo ticket kèm lý do.
Reset thiết bị: VNFITE khách tự reset trên app; TIKLUY chưa có tự reset nên cần ticket mẫu "Reset thiết bị" kèm SĐT khách và ảnh CCCD 2 mặt (file nhạy cảm); người xử lý reset ở hệ thống quản trị rồi ghi đã làm gì vào ticket.
Đổi số điện thoại: cần SĐT cũ, SĐT mới, số CCCD, CCCD 2 mặt, bằng chứng chính chủ SIM và tờ trình có chữ ký; IT sửa trực tiếp dữ liệu và cập nhật khách trong CRM vì chưa có chức năng đổi SĐT. Tất toán trước hạn: TIKLUY cho khách tự tất toán trên app khi đủ điều kiện, chỉ tạo ticket cho ngoại lệ và bắt buộc có tờ trình.
Mã khoản đầu tư của TIKLUY dạng VNF cộng 13 chữ số, là mã khách thấy trên app; đừng nhầm với số tài khoản VNF.

## Mục 6. Chọn mức khẩn

Bốn mức khẩn: Khẩn, Cao, Bình thường, Thấp. Mức khẩn không phải hạn chót cứng, chỉ ảnh hưởng người được báo và mốc ticket bị đánh dấu "Cần chú ý" khi bị bỏ quên; mốc cần tiếp nhận theo từng mức lấy từ cấu hình đang áp dụng và hiện dưới ô "Mức khẩn" trên form.
Khẩn: nhiều khách bị ảnh hưởng hoặc tiền khách có rủi ro; CRM không truy cập được; lỗi chặn hồ sơ đang chạy SLA ở các bước gần phê duyệt, kết nối vốn, giải ngân (Bước 6, 7, 8); bấm nhầm Đóng hồ sơ. Cao: một khách hoặc một hồ sơ bị chặn hay kẹt, giao dịch treo, hồ sơ đang tính giờ SLA mà không có cách làm khác.
Bình thường: việc thông thường, lỗi hiển thị, sai nhãn hoặc cột nhưng vẫn thao tác được bằng cách khác. Thấp: không gấp, hỏi cách thao tác, góp ý, đề xuất tính năng.
Ticket Khẩn nên báo trực tiếp cho IT, không chỉ chờ thông báo tự động; Khẩn hoặc Cao được báo thêm cho danh sách người phụ trách mặc định.
Sau khi tạo, người tạo và nhóm xử lý vẫn đổi được mức khẩn bằng "Sửa thông tin" (kể cả khi mẫu đã khoá mức trên form): người tạo đổi không cần lý do, nhóm xử lý đổi bắt buộc ghi lý do.

## Mục 7. Khách hàng, nhân sự liên quan và file đính kèm

Sản phẩm app (VNFITE, TIKLUY): phần "Khách hàng" tìm khách trong CRM bằng SĐT hoặc tên (từ 3 ký tự); không tìm thấy hoặc không có quyền xem khách thì nhập SĐT, ticket được đánh dấu "Khách chưa có trong CRM". Sản phẩm nội bộ (CRM, HRM, Workplace): phần "Nhân sự liên quan" chọn nhân viên cần được hỗ trợ; bỏ trống nếu là chính bạn.
File đính kèm nhận .jpg, .jpeg, .png, .webp, .gif, .heic, .pdf, .doc, .docx, .xls, .xlsx, .txt, .mp4, .mov; mỗi file tối đa 25MB, mỗi lần gửi tối đa 10 file, trên form tạo ticket tối đa 5 ảnh hoặc video lỗi; kéo thả hoặc dán ảnh (Ctrl+V) được. Mỗi file có một loại (Ảnh / video lỗi, CCCD 2 mặt, Chứng từ giao dịch, Tờ trình có chữ ký, Giấy tờ nhạy cảm khác, Tài liệu khác), hệ thống tự đoán theo đuôi file.
CCCD, chứng từ giao dịch, tờ trình và giấy tờ nhạy cảm khác là file nhạy cảm: chỉ người tạo, nhóm xử lý (khi ticket chưa kết thúc) và người có quyền xem file nhạy cảm mở được; người khác chỉ thấy dòng thông tin không kèm tên file. File không bị xoá và chỉ tải được từ trong ticket.

## Mục 8. Ví dụ ticket mẫu

Dữ liệu minh hoạ; phần trong ngoặc vuông là nơi bạn điền thông tin thật.
Ví dụ 1, lỗi hệ thống: sản phẩm VNFITE APP, mẫu "Lỗi hệ thống", tiêu đề "Bước 8: không bấm được nút Đã giải ngân". Mô tả: Kế toán đã giải ngân lúc 14:20, mã giao dịch [mã giao dịch]; bấm Đã giải ngân thì CRM hiện lỗi "[chép nguyên văn]", hồ sơ vẫn ở Bước 8; mong đợi hồ sơ sang Bước 9; đã thử F5 và đăng nhập lại vẫn lỗi. Mức Khẩn vì Bước 8 là mốc kết thúc SLA toàn trình (mẫu đã khoá mức thì tạo xong bấm "Sửa thông tin" để nâng). Đính kèm ảnh thông báo lỗi và ảnh xác nhận giao dịch của ngân hàng.
Ví dụ 2, hồ sơ vay bị vướng: sản phẩm VNFITE APP, mẫu "Hồ sơ vay đang xử lý bị vướng", tiêu đề "Bước 3: đã Trả về ĐVKD nhưng ĐVKD không thấy hồ sơ". Mô tả: QTRR bấm Trả về ĐVKD lúc 10:05 vì thiếu thông tin người tham chiếu; CRM báo thành công nhưng ĐVKD không thấy hồ sơ ở Bước 1; mong đợi hồ sơ hiện ở Bước 1 với trạng thái Trả lại. Mức Cao vì hồ sơ đang tính giờ SLA. Đính kèm ảnh chi tiết hồ sơ sau khi bấm nút và ảnh màn hình Bước 1 của ĐVKD.

## Mục 9. Màn danh sách ticket

Các tab: "Ticket của tôi" (ticket bạn tạo, xử lý hoặc được giao, kể cả đã đóng), "Cần tôi phản hồi" (ticket bạn tạo đang "Chờ bổ sung" hoặc "Đã xử lý"), "Ticket phòng ban", "Chưa ai nhận" (chỉ người xử lý và quản lý ticket thấy), "Cần chú ý", "Tất cả". Bộ lọc theo từ khoá, Sản phẩm, Loại yêu cầu, Mức khẩn, Trạng thái và khoảng ngày; có thể thao tác nhanh ngay trên dòng ticket.
Người có quyền cấu hình thấy nút "Cấu hình" ở đầu màn danh sách; màn "Cấu hình ticket" gồm các tab Sản phẩm, Loại yêu cầu, Mẫu yêu cầu, Cài đặt chung (người phụ trách nhận thông báo, ngưỡng "Cần chú ý", tự đóng và mở lại, lịch làm việc) và Hướng dẫn.

## Mục 10. Trạng thái của ticket

Bảy trạng thái: "Mới" (chưa có người nhận), "Đang xử lý" (đã có chủ trì), "Chờ bổ sung" (chờ người tạo), "Tạm hoãn" (chờ bên khác như dev, ngân hàng, đối tác), "Đã xử lý" (chờ người tạo xác nhận), "Đã đóng", "Đã huỷ".
Luồng thường gặp: Mới, có người nhận thì Đang xử lý, báo xong thì Đã xử lý, người tạo xác nhận hoặc hệ thống tự đóng thì Đã đóng. Từ Đang xử lý có thể sang Chờ bổ sung hoặc Tạm hoãn rồi quay lại, hoặc đóng ngay với một kết quả.
Kết quả khi đóng: "Đã giải quyết", "Không giải quyết", "Chưa đủ cơ sở" (đã xem xét nhưng không đủ căn cứ), "Không phải lỗi" (hệ thống chạy đúng nghiệp vụ), "Trùng" (cùng khách, cùng sự việc với ticket khác), "Người tạo không bổ sung" (hệ thống tự đặt).
Mọi thay đổi ghi trong thẻ "Lịch sử" ở màn chi tiết kèm người làm, thời gian và ghi chú.

## Mục 11. Nhận ticket, giao việc, chủ trì và phối hợp

Ticket không giao ai: mọi người có quyền xử lý bấm "Nhận xử lý" được. Giao cho phòng ban: thành viên phòng (kể cả phòng con) tự nhận ở "Ticket phòng ban". Giao cho người cụ thể: chỉ người được giao nhận được. Người phụ trách loại việc chỉ nhận thông báo, không độc quyền nhận.
Người nhận đầu tiên là chủ trì; người bấm sau thấy "... đã nhận xử lý ticket này", muốn cùng làm thì nhắn trong phần trao đổi để người trong nhóm thêm làm người phối hợp. Giao cho nhiều người: người giao chọn sẵn chủ trì, hoặc người nhận đầu tiên là chủ trì và những người còn lại tự là phối hợp.
Nhóm xử lý gồm một chủ trì và không giới hạn người phối hợp, quyền như nhau; chủ trì chỉ khác ở chỗ là đầu mối: tên hiện ở danh sách và nhận thông báo thay cả nhóm.
Người không có quyền giao việc (kể cả trưởng bộ phận cần nhờ phòng khác) không có ô chọn phòng hay người xử lý trên form: cứ tạo ticket, ghi rõ trong tiêu đề và mô tả cần bên nào hỗ trợ; người có quyền xử lý sẽ tự nhận. Chỉ giao hoặc mời phối hợp được người có quyền xử lý ticket.
Thêm phối hợp: bấm "Thêm phối hợp" và chọn người ở bất kỳ phòng nào. Rời nhóm: bấm dấu x trên tên mình ở thẻ "Người xử lý". Chủ trì bấm "Trả lại" (bắt buộc ghi lý do): người phối hợp thêm sớm nhất lên chủ trì, không còn ai thì ticket về "Mới".

## Mục 12. Yêu cầu bổ sung và cách bổ sung thông tin

Người trong nhóm xử lý bấm "Yêu cầu bổ sung", tích các mục còn thiếu, ghi chú thêm nếu cần rồi "Gửi yêu cầu"; ticket sang "Chờ bổ sung" và người tạo nhận thông báo.
Các mục có thể yêu cầu: Mô tả rõ hơn, Ảnh/video chụp lỗi, Các bước tái hiện lỗi, Số điện thoại khách, Số CCCD của khách, CCCD 2 mặt, Xác nhận của khách (tin nhắn/ghi âm đồng ý), Mã khoản đầu tư / khoản vay, Chứng từ (sao kê, UNC, ảnh chuyển khoản, mã giao dịch), Số tiền và thời điểm, Căn cứ áp dụng (số QĐ, chính sách), Tờ trình có chữ ký, Khác (ghi rõ).
Người tạo xem mục cần bổ sung ở khung "Chờ người tạo bổ sung" trong thẻ "Thông tin" hoặc tab "Cần tôi phản hồi", rồi mở ticket, bấm "Gửi bổ sung", nhập "Nội dung bổ sung" và đính kèm file nếu cần; ô "Nội dung bổ sung" bắt buộc khi mục được hỏi chỉ trả lời được bằng chữ.
Bổ sung xong ticket quay về "Đang xử lý" (chưa có chủ trì thì về "Mới"). Không bổ sung trong hạn thì được nhắc một lần rồi hệ thống tự đóng với kết quả "Người tạo không bổ sung"; hạn theo cấu hình đang áp dụng.

## Mục 13. Tờ trình

Một số việc cần tờ trình có chữ ký: đổi số điện thoại của khách, tất toán trước hạn ngoại lệ, tăng lãi hoặc ngoại lệ về luồng, tiền; người xử lý cũng có thể yêu cầu cho ticket khác khi thấy chưa đủ cơ sở. Ticket cần tờ trình là ticket hạn chế.
Tờ trình chưa duyệt điện tử trên vWork: duyệt qua email, người tạo tải ảnh hoặc PDF tờ trình đã ký lên ticket.
Cách nộp: khi tạo ticket chọn file ở dòng "Tờ trình có chữ ký" (nút "Chọn file tờ trình (từ email)") và nhập "Số tờ trình", "Ngày tờ trình", "Người ký" nếu có; hoặc khi ticket "Chờ bổ sung" thì bấm "Gửi bổ sung" và tải lên. Chỉ file do chính người tạo tải lên mới được tính.
Người trong nhóm xử lý hoặc người có quyền xem ticket hạn chế bấm "Tờ trình hợp lệ" hoặc "Tờ trình không hợp lệ" (kèm lý do, ticket quay về "Chờ bổ sung"); người tạo không tự xác nhận. Chưa có tờ trình hợp lệ thì không báo xong và không đóng "Đã giải quyết" được.

## Mục 14. Trao đổi và thông báo

Phần "Trao đổi" ở màn chi tiết để người tạo và nhóm xử lý nhắn nhau (Enter gửi, Shift + Enter xuống dòng, đính kèm file được); gõ @ để nhắc tên đồng nghiệp; giấy tờ cá nhân thì tích "Tệp nhạy cảm". Ticket đã đóng hoặc huỷ không trao đổi thêm được.
Mỗi thay đổi quan trọng (được giao, có người nhận, cần bổ sung, tạm hoãn, đã xử lý, đã đóng, có tin nhắn mới...) đều gửi thông báo đến đúng người liên quan; người tự làm thao tác không nhận thông báo của mình; người phụ trách loại việc được báo khi có ticket mới cần nhận hoặc ticket Khẩn / Cao chưa ai nhận bị "Cần chú ý". Thông báo hiện ở biểu tượng chuông, bấm để mở đúng ticket.

## Mục 15. Xác nhận, tự đóng, mở lại, huỷ và tạo ticket mới từ ticket cũ

Nhóm xử lý báo xong thì ticket sang "Đã xử lý". Người tạo kiểm tra: ổn thì bấm "Xác nhận đã xong", ticket đóng "Đã giải quyết" và không mở lại được nữa; chưa ổn thì bấm "Mở lại" kèm lý do, ticket quay về "Đang xử lý". Người tạo không phản hồi thì hệ thống tự đóng "Đã giải quyết" sau một số ngày làm việc theo cấu hình (ticket có "Cần theo dõi thêm" không tự đóng trước ngày kiểm tra).
Ticket đóng mà người tạo chưa bấm xác nhận thì người tạo hoặc nhóm xử lý mở lại được trong hạn theo cấu hình, tính bằng ngày làm việc kể từ lúc đóng. Quá hạn, đã xác nhận hoặc đã huỷ thì dùng "Tạo ticket mới từ ticket này": form điền sẵn thông tin cũ và liên kết ticket cũ; file đính kèm phải đính kèm lại.
Huỷ: người tạo bấm "Huỷ yêu cầu" kèm lý do (tạo nhầm, khách tự làm được...), chỉ khi ticket đang "Mới" hoặc "Chờ bổ sung"; ticket đang xử lý thì nhắn nhóm xử lý để họ đóng. "Xác nhận đã xong" là đồng ý việc đã xong, "Huỷ" là rút yêu cầu trước khi được xử lý.
Sửa: bấm "Sửa thông tin" khi ticket chưa xử lý xong; người tạo sửa được tiêu đề, mô tả, sản phẩm, loại, mức khẩn; nhóm xử lý sửa được sản phẩm, loại, mức khẩn; ticket đã đóng hoặc huỷ không sửa được.

## Mục 16. Cần chú ý (bôi vàng) thay cho SLA

Ticket không có hạn chót cứng (SLA). Ticket có dấu hiệu bị bỏ quên được bôi vàng cho mọi người thấy và hiện ở tab "Cần chú ý"; bôi vàng không gửi thông báo cho ai.
Bốn lý do: "Lâu chưa có ai nhận", "Lâu chưa có cập nhật" (Đang xử lý không có hoạt động), "Đã quá ngày dự kiến" (ngày nhóm xử lý tự hẹn hoặc ngày dự kiến tiếp tục khi tạm hoãn), "Tạm hoãn lâu chưa cập nhật". Ngưỡng theo mức khẩn và cấu hình đang áp dụng, chỉ tính giờ làm việc; ticket "Chờ bổ sung" và "Đã xử lý" (chờ người tạo) không bị bôi vàng.
Hoạt động mới của nhóm xử lý (trao đổi, đổi trạng thái, cập nhật) thì hết vàng, tin nhắn của người tạo thì không. Nhóm xử lý bấm "Đặt ngày dự kiến" để không bị vàng vì lâu không cập nhật trước ngày đó (dời ngày phải ghi lý do); tạm hoãn không có ngày thì ghi một dòng cập nhật là hết vàng.

## Mục 17. Ai xem được ticket nào

Nhân viên thường xem được ticket do mình hoặc người cùng phòng (kể cả phòng con) tạo, và ticket mình được giao hoặc tham gia xử lý; người có quyền xử lý, quyền giao việc cho phòng ban hoặc quản lý ticket xem được mọi ticket thường của công ty.
Ticket hạn chế (cần tờ trình hoặc được đánh dấu, nhãn "Hạn chế") chỉ người tạo, nhóm xử lý, người được giao đang chờ nhận và người có quyền xem ticket hạn chế mới thấy. Khi đã đóng, người tạo chỉ còn xem thông tin chung (mã, tiêu đề, trạng thái, kết quả, ghi chú kết luận, hạn mở lại) và nút "Mở lại" nếu còn hạn; người đã trả lại ticket hoặc bị gỡ khỏi nhóm không còn xem ticket hạn chế.
Mã khách (User ID trên app) chỉ hiện cho nhóm xử lý, IT và quản lý ticket. Mở link ticket mà không có quyền xem thì hệ thống báo không tìm thấy ticket.

## Mục 18. Hướng dẫn cho người xử lý ticket

Nhận việc: ở tab "Chưa ai nhận", "Ticket phòng ban" hoặc từ thông báo, bấm "Nhận xử lý"; có thể "Đặt ngày dự kiến" xong. Tạm hoãn: bấm "Tạm hoãn", ghi "Lý do tạm hoãn" (bắt buộc) và "Ngày dự kiến tiếp tục" nếu biết; có kết quả thì "Tiếp tục xử lý".
Nút "Báo đã xử lý xong" chỉ hiện khi đủ ba điều kiện: bạn thuộc nhóm xử lý hoặc có quyền quản lý ticket; ticket đang "Đang xử lý" (đang "Tạm hoãn" thì "Tiếp tục xử lý" trước); và nếu cần tờ trình thì tờ trình đã hợp lệ.
Báo xong: ghi kết quả và ô "Đã làm gì, trên hệ thống nào, cho khách hàng hoặc nhân viên nào" rồi "Báo xong". Nên ghi rõ đã làm gì vì hệ thống quản trị của app không ghi lại ai đã reset mật khẩu, reset thiết bị hay mở khoá. Tích "Cần theo dõi thêm sau khi xử lý" nếu cần (ghi cần theo dõi gì và ngày kiểm tra): ticket không tự đóng trước ngày đó và chủ trì được nhắc một lần.
Đóng với kết quả khác: "Đóng ticket" rồi chọn kết quả; "Không giải quyết", "Chưa đủ cơ sở", "Không phải lỗi" bắt buộc ghi lý do, "Trùng" bắt buộc chọn ticket gốc. Chỉ đánh "Trùng" khi cùng khách và cùng sự việc; cùng lỗi nhưng khác khách thì dùng "Liên kết ticket liên quan" và đóng riêng từng ticket.
Người quản lý ticket (ban lãnh đạo, trưởng IT) thao tác như nhóm xử lý trên mọi ticket, kể cả đóng hộ. Không ghi mật khẩu (kể cả mật khẩu mới đặt lại cho khách) vào ticket; gửi mật khẩu cho khách qua kênh riêng.

## Mục 19. Các thông báo lỗi thường gặp

Thông báo "Vui lòng nhập: ..." hoặc "Vui lòng đính kèm: ...": mẫu bắt buộc các trường hoặc giấy tờ được liệt kê. Lỗi file ("... vượt quá 25MB", "Chỉ đính kèm tối đa 10 file mỗi lần"): giảm dung lượng, đổi định dạng hoặc bớt file.
"Ticket vừa được người khác cập nhật, vui lòng tải lại để xem": xem lại rồi thao tác tiếp. "Ticket không ở trạng thái phù hợp cho thao tác này": thao tác không áp dụng cho trạng thái hiện tại. "Ticket này đã được giao cho người khác, bạn không thể nhận": ticket giao đích danh hoặc cho phòng khác; "... đã nhận xử lý ticket này": người khác nhận trước.
"Ticket không thể mở lại, vui lòng tạo ticket mới": quá hạn, đã xác nhận hoặc đã huỷ; dùng "Tạo ticket mới từ ticket này". "Ticket cần tờ trình hợp lệ trước khi kết luận đã giải quyết": cần "Tờ trình hợp lệ" trước khi báo xong.
"Bạn không có quyền thực hiện thao tác này trên ticket" hoặc "Chưa có quyền xử lý ticket (cần gán role người xử lý ticket): ...": tài khoản hoặc người được giao chưa có quyền; liên hệ bộ phận IT hoặc người quản trị phân quyền.

## Câu hỏi gợi ý

Tạo ticket hỗ trợ trên vWork như thế nào?
Ai được quyền tạo và xử lý ticket?
Khi nào nên gửi ticket và khi nào không?
