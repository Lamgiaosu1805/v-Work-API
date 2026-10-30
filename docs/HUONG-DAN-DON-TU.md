# Hướng dẫn sử dụng chức năng Đơn từ trên vWork

<!--
Nguồn: đọc luồng thực tế của vWork (backend `src/modules/request`, `src/helpers/*Handler.js`, `src/workflows/request-side-effects`; giao diện `src/features/requests` của vWork-website), 10/2026.
Tài liệu này đồng thời là văn bản nạp cho Trợ lý Nội quy (xem docs/HANDBOOK-ASSISTANT.md, mục "Văn bản hướng dẫn đơn từ"):
  - mỗi "## Mục N. Tiêu đề" là một mục (đơn vị trích dẫn); mỗi đoạn hoặc dòng gạch đầu dòng / đánh số là một khối;
  - viết mỗi ý trên MỘT dòng và tự đứng được (không dựa vào dòng trước), vì trợ lý trích dẫn theo từng khối.
Khi vWork đổi luồng đơn từ thì sửa file này rồi nạp lại (scripts/handbook/build-guide-manifest.ts).
-->

## Mục 1. Đơn từ dùng để làm gì và tìm ở đâu

Đơn từ là chức năng trên vWork để nhân viên gửi các đề nghị liên quan đến thời gian làm việc và chấm công cho quản lý duyệt.
Có 6 nhóm đơn: nghỉ phép (gồm nghỉ có phép, nghỉ không lương, nghỉ dài hạn), đi muộn / về sớm, quên chấm công, làm việc từ xa, đi công tác, đi gặp gỡ khách hàng.
Cách mở: vào vWork, chọn phân hệ Human Resource Management, ở menu bên trái chọn "Chấm công" rồi "Đơn từ".
Màn Đơn từ có tab "Đơn của tôi" (ai cũng có), tab "Xử lý yêu cầu" (dành cho người có quyền duyệt, kèm số đơn đang chờ) và tab "Đơn từ nhân sự" (dành cho người được xem đơn toàn công ty, thường là Phòng Hành chính - Nhân sự).
Một đơn có 4 trạng thái: "Chờ duyệt", "Đã duyệt", "Từ chối" và "Đã huỷ".
Kết quả của đơn đã duyệt được hệ thống cập nhật vào bảng công; xem ở "Bảng công của tôi".

## Mục 2. Các bước tạo một đơn

Bước 1: vào Chấm công, Đơn từ, tab "Đơn của tôi", bấm nút "Tạo đơn".
Bước 2: ở ô "Loại đơn*" chọn một trong các loại: Quên chấm công, Nghỉ phép, Nghỉ không lương, Nghỉ dài hạn, Đi muộn, Về sớm, Đi công tác, Đi gặp gỡ khách hàng, Làm việc từ xa.
Bước 3: điền các trường của loại đơn đó (xem từng mục riêng bên dưới); các trường có dấu * là bắt buộc.
Bước 4: nhập "Lí do*". Lý do là bắt buộc với mọi loại đơn và tối đa 100 ký tự.
Bước 5: xem phần "Luồng duyệt áp dụng" ở cuối form: hệ thống hiển thị người duyệt cấp 1 (quản lý trực tiếp) và cấp 2 (quản lý gián tiếp) của bạn.
Bước 6: bấm "Tạo đơn". Đơn chuyển sang trạng thái "Chờ duyệt" và người duyệt cấp 1 nhận thông báo trên vWork.
Hệ thống kiểm tra đơn ngay khi gửi; nếu vi phạm một quy tắc (trùng đơn, hết phép, sai giờ...) sẽ hiện thông báo lỗi và đơn không được tạo (xem Mục 11).

## Mục 3. Ai duyệt đơn và cần mấy cấp duyệt

Người duyệt cấp 1 là quản lý trực tiếp của bạn, do Phòng Hành chính - Nhân sự cài trên hồ sơ nhân viên. Nếu chưa cài thì người duyệt cấp 1 là trưởng bộ phận (người quản lý phòng ban của bạn, tính lên phòng ban cấp trên nếu phòng ban của bạn chưa có người quản lý).
Người duyệt cấp 2 là quản lý gián tiếp, thường là cấp trên của người duyệt cấp 1 (hoặc trưởng bộ phận của bạn nếu khác người cấp 1). Nếu không xác định được người cấp 2 thì đơn chỉ có 1 cấp duyệt.
Nghỉ phép dưới 2 ngày: chỉ quản lý trực tiếp (cấp 1) duyệt; quản lý gián tiếp (cấp 2) chỉ nhận thông tin, không duyệt.
Nghỉ phép từ 2 ngày trở lên: duyệt tuần tự 2 cấp, cấp 1 duyệt trước rồi đơn mới chuyển sang cấp 2; đơn chỉ được duyệt xong khi đủ cả hai cấp. Nếu chuỗi duyệt chỉ có 1 cấp thì 1 lượt duyệt là đủ.
Đi muộn / về sớm: trong mỗi kỳ lương, các đơn thứ 1 đến thứ 3 chỉ cần 1 người trong chuỗi duyệt; từ đơn thứ 4 trở đi trong cùng kỳ lương cần 2 người duyệt.
Quên chấm công: trong mỗi kỳ lương, các lần quên đầu chỉ cần 1 người trong chuỗi duyệt; từ lần quên thứ 6 trở đi trong cùng kỳ lương cần 2 người duyệt.
Làm việc từ xa, đi công tác, đi gặp gỡ khách hàng: chỉ cần 1 người trong chuỗi duyệt (cấp 1 hoặc cấp 2) duyệt là xong.
Kỳ lương tính từ ngày 26 của tháng này đến hết ngày 25 của tháng sau. Số lần đi muộn / về sớm và quên chấm công được hệ thống tự đếm trong kỳ lương, tính cả đơn đang chờ duyệt và đơn đã duyệt.
Nếu một người duyệt từ chối thì đơn bị từ chối ngay, kể cả khi người duyệt trước đã duyệt.
Người có quyền duyệt mọi đơn toàn công ty (thường là lãnh đạo) duyệt xong thì đơn được chốt ngay, không phải chờ các cấp khác.
Không ai duyệt được đơn của chính mình.
Thông báo: khi bạn tạo đơn, người duyệt cấp 1 nhận thông báo "Đơn xin phép mới". Với đơn cần 2 người duyệt, sau khi người duyệt đầu tiên duyệt, bạn nhận thông báo "Đơn đã được duyệt bước 1/2" và người duyệt tiếp theo nhận thông báo chờ duyệt. Khi có kết quả cuối cùng bạn nhận thông báo "Đơn được duyệt" hoặc "Đơn bị từ chối"; Phòng Hành chính - Nhân sự và những người trong chuỗi duyệt cũng nhận thông báo kết quả.

## Mục 4. Đơn nghỉ phép (Nghỉ phép, Nghỉ không lương, Nghỉ dài hạn)

Nghỉ phép: nghỉ có phép trong 1 ngày hoặc 1 buổi. Chọn "Ngày" và "Buổi nghỉ*": Cả ngày (08:00 - 17:00), Buổi sáng (08:00 - 12:00) hoặc Buổi chiều (13:00 - 17:00).
Nghỉ không lương: nghỉ không lương trong 1 ngày hoặc 1 buổi, nhập giống đơn Nghỉ phép nhưng không trừ ngày phép.
Nghỉ dài hạn: nghỉ nhiều ngày liên tiếp. Nhập "Từ ngày*" và "Ca bắt đầu*" (buổi sáng hoặc buổi chiều), "Đến ngày*" và "Ca kết thúc*" (buổi sáng hoặc buổi chiều), rồi chọn "Hình thức nghỉ*": "Nghỉ có phép" hoặc "Nghỉ không lương".
Cách tính số ngày nghỉ: Chủ nhật không tính; thứ Bảy tính 0,5 ngày (chỉ có buổi sáng); thứ Hai đến thứ Sáu tính 1 ngày nếu nghỉ cả ngày và 0,5 ngày nếu nghỉ một buổi. Hệ thống tự tính, bạn không phải nhập số ngày.
Ngày phép được trừ ngay khi bạn gửi đơn và được hoàn lại nếu đơn bị từ chối hoặc bạn thu hồi đơn.
Mỗi tháng hệ thống tự cộng 1 ngày phép cho nhân viên thuộc diện được tích luỹ phép năm. Số ngày phép còn lại hiển thị ở "Quỹ ngày nghỉ phép" trên Bảng công của tôi.
Nếu số ngày xin nghỉ có phép nhiều hơn số ngày phép còn lại thì phần vượt tự động được tính là nghỉ không lương. Ví dụ còn 1,5 ngày phép mà xin nghỉ có phép 3 ngày thì 1,5 ngày là nghỉ có phép và 1,5 ngày là nghỉ không lương.
Nếu bạn không còn ngày phép nào thì không tạo được đơn nghỉ có phép; hãy chọn Nghỉ không lương.
Nếu ngày nghỉ bắt đầu trong tháng liền kề sau, được ứng trước tối đa 1 ngày phép của tháng đó.
Nhân viên thuộc loại hợp đồng hoặc trạng thái chưa được dùng ngày phép năm (do Phòng Hành chính - Nhân sự cấu hình) không tạo được đơn nghỉ có phép, chỉ tạo được đơn nghỉ không lương.
Chỉ tạo được đơn nghỉ có ngày bắt đầu từ 3 ngày trước đến tương lai; không tạo đơn cho ngày nghỉ đã qua quá 3 ngày.
Không được tạo đơn nghỉ trùng với một đơn nghỉ khác đang "Chờ duyệt" hoặc "Đã duyệt" trong cùng khoảng thời gian.
Khoảng nghỉ không được chứa ngày lễ (trừ ngày lễ rơi vào Chủ nhật). Nếu có ngày lễ ở giữa, hãy tách thành 2 đơn, một đơn trước ngày lễ và một đơn sau ngày lễ.
Thời hạn báo trước khi xin nghỉ thực hiện theo Nội quy lao động (Điều 12); vWork không tự kiểm tra thời hạn báo trước.
Khi đơn nghỉ được duyệt, các ngày nghỉ được ghi vào bảng công (nghỉ có phép tính công theo ngày nghỉ, nghỉ không lương không tính công). Nếu bạn vẫn đi làm trong ngày đã được duyệt nghỉ (có check-in trước 10:00 thì buổi sáng nghỉ bị huỷ, có check-out sau 14:00 thì buổi chiều nghỉ bị huỷ) thì hệ thống ưu tiên dữ liệu chấm công và hoàn lại ngày phép của buổi tương ứng.

## Mục 5. Đơn đi muộn / về sớm

Chọn "Loại đơn*" là "Đi muộn" hoặc "Về sớm". Nhập "Ngày", chọn "Ca làm việc*" của ngày đó (ví dụ Ca hành chính), nhập "Số phút*" đi muộn hoặc về sớm (từ 1 đến 480 phút) và "Lí do*".
Mỗi ngày, mỗi ca và mỗi loại (đi muộn hoặc về sớm) chỉ tạo được 1 đơn đang "Chờ duyệt" hoặc "Đã duyệt".
Đơn đi muộn / về sớm được duyệt thì số phút đi muộn hoặc về sớm của ngày đó không bị tính xử lý hoặc phạt chấm công. Nếu không có đơn được duyệt thì ngày đó bị xử lý theo quy định chấm công.
Số đơn đi muộn / về sớm được đếm chung theo kỳ lương (26 tháng này đến 25 tháng sau); từ đơn thứ 4 trong kỳ cần 2 người duyệt (xem Mục 3).
Có thể tạo đơn cho ngày đã qua; không có giới hạn 3 ngày như đơn nghỉ phép.

## Mục 6. Đơn quên chấm công

Chọn "Loại đơn*" là "Quên chấm công". Nhập "Ngày", chọn "Loại quên chấm công*" là "Quên check-in" hoặc "Quên check-out", nhập "Giờ chấm công dự kiến*" (giờ thực tế bạn đến hoặc về) và "Lí do*".
Giờ chấm công dự kiến phải nằm trong ngày bạn chọn.
Mỗi ngày chỉ tạo được 1 đơn quên chấm công đang "Chờ duyệt" hoặc "Đã duyệt". Form hiện chỉ cho chọn quên check-in hoặc quên check-out; nếu quên cả hai trong cùng một ngày thì hãy liên hệ Phòng Hành chính - Nhân sự để được hỗ trợ.
Không tạo được đơn nếu ngày đó đã có đủ cả dữ liệu check-in và check-out trong hệ thống.
Nếu hệ thống đã có giờ check-out thì giờ check-in dự kiến phải trước giờ check-out đó; nếu đã có giờ check-in thì giờ check-out dự kiến phải sau giờ check-in đó.
Khi đơn được duyệt, giờ dự kiến được ghi vào bảng công và hệ thống tính lại công của ngày đó.
Số lần quên chấm công được đếm theo kỳ lương (26 tháng này đến 25 tháng sau); từ lần thứ 6 trong kỳ cần 2 người duyệt (xem Mục 3). Mức xử lý khi quên chấm công thực hiện theo quy định chấm công của công ty.

## Mục 7. Đơn làm việc từ xa

Chọn "Loại đơn*" là "Làm việc từ xa". Nhập "Ngày diễn ra sự kiện*" (ngày làm việc từ xa) và "Lí do*". Mỗi đơn áp dụng cho 1 ngày.
Không tạo được đơn nếu ngày đó đã có đơn làm việc từ xa đang "Chờ duyệt" hoặc "Đã duyệt".
Chỉ cần 1 người trong chuỗi duyệt duyệt đơn.
Khi đơn được duyệt, ngày đó được ghi nhận là ngày làm việc từ xa và tính công như ngày làm việc bình thường (thứ Bảy tính 0,5 công).

## Mục 8. Đơn đi công tác

Chọn "Loại đơn*" là "Đi công tác". Nhập "Từ ngày*", "Đến ngày*", "Địa điểm*" (địa điểm công tác, bắt buộc) và "Lí do*".
Ngày bắt đầu không được sau ngày kết thúc.
Không tạo được đơn nếu khoảng thời gian trùng với một đơn đi công tác khác đang "Chờ duyệt" hoặc "Đã duyệt".
Chỉ cần 1 người trong chuỗi duyệt duyệt đơn.
Khi đơn được duyệt, các ngày trong khoảng công tác (trừ Chủ nhật) được ghi nhận là ngày đi công tác và tính công như ngày làm việc bình thường (thứ Bảy tính 0,5 công).

## Mục 9. Đơn đi gặp gỡ khách hàng

Chọn "Loại đơn*" là "Đi gặp gỡ khách hàng". Nhập "Ngày diễn ra sự kiện*", "Giờ bắt đầu*", "Giờ kết thúc*" và "Lí do*". Mỗi đơn áp dụng cho 1 ngày.
Giờ kết thúc phải sau giờ bắt đầu.
Không tạo được đơn nếu khung giờ trùng với một đơn gặp khách hàng khác của bạn trong cùng ngày đang "Chờ duyệt" hoặc "Đã duyệt".
Chỉ cần 1 người trong chuỗi duyệt duyệt đơn.
Khi đơn được duyệt, ngày đó được ghi nhận là ngày đi gặp khách hàng và tính công như ngày làm việc bình thường (thứ Bảy tính 0,5 công).

## Mục 10. Theo dõi, thu hồi và tạo lại đơn

Xem đơn của mình: vào tab "Đơn của tôi", dùng bộ lọc loại đơn và trạng thái, bấm "Xem chi tiết" để xem nội dung và tiến trình duyệt (ví dụ "Duyệt cấp 1", "Chờ tới lượt duyệt", "Đang chờ duyệt").
Thu hồi đơn: mở chi tiết đơn đang "Chờ duyệt", bấm "Thu hồi đơn" rồi xác nhận. Đơn chuyển sang "Đã huỷ" và ngày phép đã bị trừ (nếu có) được hoàn lại.
Chỉ thu hồi được khi đơn đang "Chờ duyệt" và chưa có ai duyệt. Đơn cần 2 người duyệt (ví dụ nghỉ từ 2 ngày) mà đã có người duyệt thì không tự thu hồi được; hãy liên hệ người duyệt để từ chối đơn.
Đơn đã "Đã duyệt" hoặc "Từ chối" không thu hồi được. Nếu cần điều chỉnh đơn đã duyệt, hãy liên hệ Phòng Hành chính - Nhân sự.
Đơn bị từ chối: mở chi tiết đơn để xem lý do từ chối, bấm "Tạo lại đơn" để mở form đã điền sẵn thông tin cũ, sửa rồi gửi lại. Ngày phép đã bị trừ của đơn bị từ chối được hoàn lại.
Thông báo kết quả duyệt hiện ở biểu tượng chuông trên vWork; bấm vào thông báo để mở đúng đơn.

## Mục 11. Hướng dẫn cho người duyệt đơn

Mở tab "Xử lý yêu cầu" trong Đơn từ (số trong ngoặc là số đơn đang chờ bạn) hoặc bấm vào thông báo để mở thẳng đơn cần duyệt.
Bấm "Xem chi tiết" để xem người gửi, loại đơn, ngày, lý do và tiến trình duyệt, rồi bấm "Duyệt đơn" hoặc "Từ chối". Hệ thống hỏi xác nhận ("Xác nhận phê duyệt đơn?" hoặc "Xác nhận từ chối yêu cầu?").
Khi từ chối, nên nhập lý do vào ô "Nhập lí do từ chối cụ thể..." để nhân viên biết và chỉnh sửa.
Bạn chỉ duyệt được đơn của nhân viên mà bạn nằm trong chuỗi duyệt (quản lý trực tiếp hoặc quản lý gián tiếp của nhân viên đó). Nếu không, hệ thống báo "Bạn không được chỉ định duyệt đơn này".
Đơn nghỉ phép dưới 2 ngày: chỉ cấp 1 duyệt được; cấp 2 sẽ thấy thông báo "Đơn nghỉ dưới 2 ngày do quản lý trực tiếp duyệt, quản lý gián tiếp chỉ nhận thông tin".
Đơn nghỉ phép từ 2 ngày: cấp 2 chỉ duyệt được sau khi cấp 1 đã duyệt; trước đó hệ thống báo "Đơn đang chờ quản lý trực tiếp duyệt trước".
Với đơn cần 2 người duyệt, một người không duyệt được 2 lần; hệ thống báo "Bạn đã duyệt đơn này rồi".
Bạn không duyệt được đơn của chính mình ("Không thể tự duyệt đơn của mình").
Khi đơn đủ số lượt duyệt, hệ thống tự cập nhật bảng công của nhân viên; khi bạn từ chối đơn nghỉ có phép, ngày phép được hoàn lại cho nhân viên.

## Mục 12. Các thông báo lỗi thường gặp khi tạo đơn

"Vui lòng nhập lý do" hoặc "Lý do không được vượt quá 100 ký tự": nhập lý do ngắn gọn, tối đa 100 ký tự.
"Chỉ được tạo đơn trong vòng 3 ngày gần nhất": đơn nghỉ phép có ngày bắt đầu đã qua quá 3 ngày; liên hệ Phòng Hành chính - Nhân sự nếu cần xử lý.
"Bạn không còn ngày nghỉ phép có lương": hết ngày phép; chọn Nghỉ không lương, hoặc nếu nghỉ vào tháng liền sau thì có thể ứng trước tối đa 1 ngày.
"Loại hợp đồng hiện tại chưa được sử dụng ngày phép có lương": loại hợp đồng của bạn chưa được dùng phép năm; chọn Nghỉ không lương.
"Đã có đơn nghỉ trong khoảng thời gian này": đã có đơn nghỉ khác chờ duyệt hoặc đã duyệt trùng thời gian; kiểm tra lại ở tab "Đơn của tôi".
"Khoảng thời gian nghỉ chứa ngày lễ ... Vui lòng tách đơn": tách đơn nghỉ thành các đơn riêng, không để ngày lễ nằm trong khoảng nghỉ.
"Khoảng thời gian nghỉ không hợp lệ" hoặc "Ngày bắt đầu không được lớn hơn ngày kết thúc": kiểm tra lại ngày và ca bắt đầu, ca kết thúc.
"Đã có đơn cho ca này": đã có đơn đi muộn hoặc về sớm cùng ngày, ca, loại.
"Đã có đơn quên chấm công cho ngày này": mỗi ngày chỉ có 1 đơn quên chấm công.
"Ngày này đã có đủ dữ liệu chấm công, không cần tạo đơn quên chấm công": ngày đó đã có cả check-in và check-out.
"Giờ check-in dự kiến phải trước giờ check-out đã có trong hệ thống" hoặc "Giờ check-out dự kiến phải sau giờ check-in đã có trong hệ thống": sửa giờ dự kiến cho hợp lý với dữ liệu chấm công đã có.
"Đã có đơn remote trong khoảng thời gian này", "Đã có đơn công tác trong khoảng thời gian này" hoặc "Đã có đơn gặp khách hàng trùng khung giờ này": đã có đơn cùng loại trùng thời gian.
"Vui lòng nhập địa điểm công tác" hoặc "Giờ kết thúc phải sau giờ bắt đầu": nhập đủ và đúng các trường bắt buộc.
"Đơn đã có người duyệt, không thể tự huỷ": đơn đã có người duyệt trước; liên hệ người duyệt để từ chối đơn.

## Câu hỏi gợi ý

Tạo đơn xin nghỉ phép trên vWork như thế nào?
Đơn nghỉ phép được ai duyệt?
Quên chấm công thì tạo đơn ở đâu?
