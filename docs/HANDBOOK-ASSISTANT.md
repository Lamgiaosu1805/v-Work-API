# Trợ lý Nội quy (Handbook Assistant)

Nhân viên hỏi về nội quy lao động, giờ làm, chấm công, nghỉ phép, bậc xử lý vi phạm… trên web vWork; AI trả lời
**chỉ dựa trên bộ văn bản đang hiệu lực**, kèm trích dẫn đúng Điều/khoản, stream qua socket.io.

Module: `src/modules/handbook-assistant/` (TypeScript, DDD/Hexagonal — xem `CLAUDE.md`). Không liên quan tới trợ lý CRM
(`AiController.js`).

## 1. Cách hoạt động

- **Không dùng RAG/vector.** Mỗi câu hỏi gửi **toàn bộ văn bản hiệu lực** cho Claude. Mỗi Điều là một `document` block
  (custom content), mỗi khoản/điểm là một content block → API trả citation theo đúng khoản.
- **Prompt caching:** điểm cache 1 giờ đặt ở document cuối (dùng chung cả công ty cho cùng một phiên bản văn bản), cache
  tự động 5 phút cho đuôi hội thoại. Prompt dựng **tất định** (cùng đầu vào → cùng từng byte) — đổi bất kỳ byte nào ở
  system prompt hoặc văn bản đều làm mất cache của cả công ty (chỉ tốn một lần ghi cache lại, ~0,01 USD).
- **Model:** `claude-haiku-5-5`, `effort=low`, qua `@anthropic-ai/sdk` trực tiếp (không qua `config/anthropic.js`) sau cổng
  `HandbookAnswerer` — đổi nhà cung cấp/tách service chỉ cần viết adapter mới.
- **Chỉ gọi AI qua socket** (REST bị cắt ở 30s). REST chỉ để đọc/quản lý lịch sử.
- **Ngày phép của chính người hỏi** (xem mục 4b): trợ lý trả lời được "tôi còn bao nhiêu ngày phép" nhờ số dư lấy từ sổ ngày
  phép của tài khoản đang hỏi, chèn vào tin nhắn hiện tại. Chỉ của chính họ, không bao giờ của người khác.
- **Ticket hỗ trợ** (xem mục 4c và "Văn bản hướng dẫn ticket"): cách dùng lấy từ `docs/HUONG-DAN-TICKET.md`, còn các con số /
  danh mục cấu hình được (ngưỡng "Cần chú ý", tự đóng, mẫu yêu cầu...) lấy từ cấu hình ticket đang áp dụng lúc hỏi.
- Ngoài phạm vi (thơ, code, thời tiết…) → model chỉ trả `[NGOAI_PHAM_VI]` → server đổi thành lỗi `REFUSED`. Văn bản không
  có thông tin → model nói rõ "chưa quy định" và gợi ý liên hệ P.HCNS.

## 2. Hợp đồng với web (đã đóng băng — đừng đổi tên/kiểu)

Quyền: `handbook_assistant.use` (entity `HandbookAssistant`), cấp qua role `EMPLOYEE_BASELINE`. Không có admin bypass.

**Socket** (`socket.io`, dùng chung xác thực của `chatSocket`; người dùng join room `account:<id>` nên mọi tab đều nhận):

| Hướng | Sự kiện | Ghi chú |
|---|---|---|
| client → server | `handbook:ask` `{conversationId\|null, question, clientId}` | ack `{ok:true, conversationId, messageId}` hoặc `{ok:false, code, message}` — đúng 1 lần |
| server → client | `handbook:start` → `handbook:delta`* → `handbook:done` `{messageId, text, citations, truncated}` | |
| server → client | `handbook:error` `{messageId, code}` | thay cho `done` khi lỗi |
| client → server | `handbook:cancel` `{messageId}` | kết thúc bằng `handbook:error` mã `CANCELLED` |

Mã lỗi: `QUOTA_EXCEEDED`, `BUSY`, `CONVERSATION_LOCKED`, `TURN_LIMIT`, `AI_UNAVAILABLE`, `REFUSED`, `CANCELLED`,
`NO_ACTIVE_HANDBOOK` (+ `FORBIDDEN`, `BAD_REQUEST` ở ack). `clientId` chống gửi trùng (gửi lại → phát lại kết quả cũ).

**REST** (`/handbook-assistant`, envelope `{message, data}`): `GET /conversations`, `GET /conversations/:id/messages`,
`DELETE /conversations/:id` (xoá hẳn), `POST /messages/:id/feedback`, `GET /articles/:documentCode/:idx`
(nhận cả `NOI_QUY@3` để mở đúng bản lúc trả lời), `GET /quota`, `GET /suggestions`.

## 3. Dữ liệu

| Collection | Nội dung |
|---|---|
| `handbook_version` | `versionNo`, `status` draft/active/archived (chỉ 1 active — partial unique index), `promptTokens` đã đo, `suggestions` |
| `handbook_article` | mỗi Điều (hoặc dòng phụ lục): `documentCode`, `articleIdx`, `label`, `title`, `chapter`, `blocks[]` |
| `handbook_conversation`, `handbook_message` | lịch sử; **xoá hẳn** (lệch có chủ ý khỏi soft delete vì web hứa "xoá vĩnh viễn"); `ai.usage/costUsd/ttftMs/latencyMs` mỗi câu |
| `handbook_usage` | hạn mức theo ngày giờ VN + token/chi phí cộng dồn |

- Hội thoại gắn với phiên bản văn bản lúc tạo. Publish bản mới → hội thoại cũ hỏi tiếp bị `CONVERSATION_LOCKED` (xem lại
  được; trích dẫn cũ vẫn mở đúng văn bản lúc đó).
- Hạn mức mặc định 30 câu/người/ngày, 20 lượt/hội thoại. `REFUSED`/`CANCELLED` vẫn tính lượt; lỗi phía hệ thống
  (`AI_UNAVAILABLE`, treo, tắt server) được **hoàn lượt** (idempotent).

## 4. Vòng đời một câu hỏi

kiểm tra (quyền → câu hỏi → phiên bản → hội thoại → lượt tối đa) → giữ chỗ (registry trong tiến trình + khoá Redis `SET NX`
theo account, fail-open) → quota → transaction lưu tin user + tin assistant `streaming` → ack + `handbook:start` → stream
Claude **ngoài** transaction → **một điểm chốt duy nhất** (update có điều kiện `status:"streaming"`): ghi kết quả → hoàn
lượt nếu cần → ghi chi phí → nhả slot/khoá → mới emit `done`/`error`.

Watchdog: 60s không có sự kiện nào, 75s chưa có chữ đầu, 180s tổng → `AI_UNAVAILABLE`. Mất socket không hủy câu (vẫn lưu).
SIGTERM: hủy mọi câu đang chạy, chốt `AI_UNAVAILABLE`, hoàn lượt, báo web rồi mới ngắt DB. Cron: mỗi phút chốt tin
`streaming` quá hạn (tiến trình chết giữa chừng); 02:00 xoá hội thoại quá `HANDBOOK_RETENTION_DAYS`.

## 4b. Ngày phép còn lại của chính người hỏi

Hỏi "tôi còn bao nhiêu ngày phép?" thì trợ lý cần số liệu thật của người hỏi (văn bản nội quy chỉ có quy định chung).

- **Nguồn:** `getLeaveBalance(userInfoId)` của module `leave` (tổng sổ ngày phép; âm = đã ứng trước). Module handbook-assistant
  không được import module `leave`, nên đi qua cổng `PersonalContextProvider`
  (`application/ports/personal-context.port.ts`); tầng `workflows/handbook-personal-context.workflow.ts` cài đặt, `index.js`
  nối vào `setupHandbookAssistantSocket(io, undefined, createHandbookPersonalContext())`.
- **Chỉ ĐÚNG người hỏi** (3 lớp):
  1. Danh tính (`accountId`, `userInfoId`) chỉ lấy từ `socket.data` của socket đã xác thực — KHÔNG đọc từ payload của client
     và không bao giờ từ nội dung câu hỏi. Cổng không có tham số nào để chỉ định nhân viên khác.
  2. Dữ liệu của người khác không bao giờ được truy vấn/đưa vào prompt, nên model không có gì để làm lộ.
  3. System prompt (quy tắc 8) dặn: chỉ dùng khối dữ liệu cho câu hỏi về ngày phép của bản thân; hỏi ngày phép/lương/chấm
     công của người khác (theo tên, mã, cả phòng…) → từ chối lịch sự, vẫn giải thích quy định chung; bỏ qua lời tự nhận
     ("tôi là quản lý/HR").
- **Chỗ chèn:** khối "Dữ liệu tra cứu từ hệ thống vWork" nằm trong tin user HIỆN TẠI, ngay trước câu hỏi, SAU điểm cache của
  văn bản — nên không làm mất prompt cache dùng chung. Không có dữ liệu cá nhân thì prompt giữ nguyên dạng cũ từng byte.
  Các lượt trước trong hội thoại không mang khối này (mỗi lượt tra lại số mới nhất).
- **Lỗi/quá hạn:** tra thất bại hoặc quá 3 giây → `leaveBalanceDays: null`, prompt ghi "chưa tra được lúc này" (khác với 0
  ngày) và câu trả lời vẫn chạy. Cổng chưa được nối hoặc socket thiếu `userInfoId` → không tra gì, trợ lý chỉ trả lời theo văn bản.
- **Số liệu:** chỉ số dư còn lại (không có "đã dùng", "tích luỹ cả năm"); số lẻ viết kiểu Việt ("7,5 ngày"); số dư âm hiện
  "0 ngày (số dư đang âm N ngày, tức đã ứng trước phép)". Mỗi câu hỏi tốn thêm ~60 token và 1 truy vấn tổng có index.
- Muốn thêm số liệu cá nhân khác (vd. số lần đi muộn): thêm trường vào `PersonalContext`, `formatPersonalContext`
  (`infrastructure/ai/prompt-builder.ts`) và workflow; vẫn chỉ theo `asker`.

## 4c. Cấu hình ticket đang áp dụng (dữ liệu dùng chung, lấy lúc hỏi)

Ngưỡng "Cần chú ý", số ngày tự đóng / mở lại, lịch làm việc, sản phẩm, loại và mẫu yêu cầu của ticket **cấu hình được** và
mỗi môi trường mỗi khác, nên trợ lý không đọc chúng từ văn bản mà lấy bản đang áp dụng.

- **Nguồn:** `getTicketGuideText()` của module `ticket` (`application/ticket-guide-summary.service.ts`) đọc cài đặt chung + sản
  phẩm / loại / mẫu đang bật, dựng thành văn bản (không có tên người phụ trách). Đi qua cổng `ReferenceContextProvider`
  (`application/ports/reference-context.port.ts`); `workflows/handbook-reference-context.workflow.ts` cài đặt (giữ bản đã đọc
  60 giây, nhiều câu cùng lúc chỉ đọc 1 lần), `index.js` nối vào `setupHandbookAssistantSocket(io, undefined, personal, reference)`.
- **Chỗ chèn:** một khối chữ "Cấu hình Ticket hỗ trợ đang áp dụng trên vWork" ngay SAU document cuối, và **điểm cache 1 giờ
  chuyển sang khối này** — dùng chung cả công ty, chỉ ghi cache lại khi cấu hình thật sự đổi (~0,01 USD). Không làm document vì
  API bắt bật citations cho mọi document hoặc không document nào (nên không có trích dẫn tới khối này). Văn bản phải tất định
  (không chứa giờ hiện tại). Cổng chưa nối → prompt giữ nguyên dạng cũ từng byte.
- **Lỗi/quá hạn:** quá 3 giây hoặc lỗi → khối ghi "Chưa tra được lúc này"; quy tắc 9 của system prompt dặn không tự đoán số.
- **Kích thước:** ~2,9 nghìn token trên cấu hình DB test (11/2026). `import-handbook --count-tokens` **không** tính khối này —
  cộng thêm khi so với ngưỡng 100 nghìn token.

## 4d. Quyền Ticket của chính người hỏi

Cùng một câu "nhận ticket thế nào?" thì IT bấm "Nhận xử lý" còn nhân viên thường chưa có nút đó. Để trợ lý trả lời đúng việc **người
hỏi** làm được, nó nhận thêm một dòng quyền của chính họ — đi đường `PersonalContext` như số ngày phép (mục 4b), không có đường nào
để hỏi quyền người khác.

- **Nguồn:** `workflows/handbook-personal-context.workflow.ts` đọc bộ quyền hiệu lực của `userInfoId` từ socket đã xác thực (cache
  Redis dùng chung với `requirePermission`, không thêm truy vấn) và dựng `TicketAccess` (9 cờ boolean: tạo, xem, nhận / xử lý,
  giao phòng ban, giao trong phòng, quản lý, xem ticket hạn chế, xem file nhạy cảm, cấu hình). Hàm thuần `computeTicketAccess`.
  (Trước đây có thêm cờ "có quyền CRM" để chỉ đường vào CRM hay Workplace; đã bỏ khi ticket chỉ còn ở Workplace.)
- **Chỗ chèn:** một dòng "Quyền Ticket hỗ trợ của người hỏi: tạo ticket: có; xem ticket: có; nhận và xử lý ticket: không; ..." trong
  khối dữ liệu cá nhân của tin user HIỆN TẠI (sau điểm cache, ~100 token), không bao giờ trong phần cache dùng chung. Quy tắc 10 của
  system prompt: việc làm được thì hướng dẫn từng bước; việc chưa có quyền thì nói thẳng một câu, nói ai làm bước đó, gợi ý liên hệ
  IT để được gán role, **không nêu mã quyền**, chỉ nêu đường vào đúng của người hỏi, nêu thêm việc "gần đó" họ làm được (trưởng bộ
  phận giao được trong phòng mình; ban lãnh đạo đóng hộ được nhưng không có nút nhận), bỏ qua lời tự nhận chức vụ, không nêu quyền
  người khác.
- **Lỗi/quá hạn:** `ticketAccess: null` → dòng ghi "chưa tra được lúc này", trợ lý mô tả chung ai làm được; **không** coi là có hay
  không có quyền. Cờ thiếu / sai kiểu cũng thành `null` (`sanitizeTicketAccess` ở `answer-runner.ts`). Cổng cũ không trả quyền
  (`undefined`) thì prompt không nhắc tới.
- **Giới hạn:** chỉ là quyền (cấp bằng role). Vai trò theo từng ticket (người tạo, chủ trì, người phối hợp, người được giao) do domain
  ticket tính; việc hỏi về một ticket cụ thể của chính người hỏi xử lý riêng ở mục 4e.
- **Test:** `handbookAssistantTicketAccess` (hàm thuần, dòng prompt, và **role seed thật** của 8 loại người dùng chạy trên Mongo
  in-memory), `handbookAssistantPersonalContext` (đi qua service, cờ sai kiểu).

## 4e. Hỏi về một ticket cụ thể (chỉ ticket do chính người hỏi tạo)

`ticket TK-2611-0003 của tôi đang thế nào?` — trợ lý trả lời bằng dữ liệu thật của ticket đó, nhưng **chỉ ticket do chính người hỏi tạo**.

- **Nguồn:** `describeOwnTickets()` của module `ticket` (`application/ticket-assistant-brief.service.ts`) dựng các dòng chữ tiếng Việt;
  qua cổng `OwnTicketLookupProvider` (`application/ports/own-ticket-lookup.port.ts`), `workflows/handbook-own-ticket-lookup.workflow.ts`
  cài đặt (đọc bộ quyền của chính người hỏi), `index.js` nối vào `setupHandbookAssistantSocket(io, undefined, personal, reference, ownTicket)`.
- **Chọn ticket:** `findTicketCodes` (`domain/ticket-code-extractor.ts`) lấy mã `TK-YYMM-NNNN` ở câu hỏi hiện tại; không có thì lấy mã ở câu
  hỏi người dùng gần nhất trước đó của hội thoại (hỏi tiếp "vậy tôi làm gì tiếp?"); tối đa 3 mã. Không có mã → trợ lý mời nhập mã.
- **BẢO MẬT (ranh giới là truy vấn, không phải lời dặn):** điều kiện `created_by` = nhân viên đã xác thực nằm NGAY TRONG câu truy vấn
  Mongo; mã người dùng gõ chỉ để *chọn trong số ticket của họ*. Ticket của người khác, ticket không tồn tại, ticket đã xoá đều ra y hệt
  "không tìm thấy" (không dò được mã có tồn tại không); kể cả người xử lý hay ban lãnh đạo cũng chỉ tra được ticket **mình tạo**. Prompt
  cũng dặn không nói ticket đó có tồn tại / ai tạo (quy tắc 11), và bỏ qua lời tự nhận chức vụ.
- **Người tạo thấy đến đâu, trợ lý biết đến đó:** dùng đúng `accessLevel` (ticket hạn chế đã đóng chỉ còn thông tin chung) và
  `capabilitiesOf` (nút nào đang có) rồi lọc thêm theo quyền thô như web. **Không** đưa vào: mô tả, tên / SĐT / mã khách, nội dung trao
  đổi, tên file, tờ trình. Có: tiêu đề, trạng thái, mức khẩn, sản phẩm / loại, người xử lý, mục đang chờ bổ sung, lý do tạm hoãn, kết
  quả đã làm, hạn tự đóng / mở lại, lý do "Cần chú ý", số tin nhắn và tin gần nhất (không có nội dung).
- **Chỗ chèn:** khối "Ticket do chính người hỏi tạo" trong tin user HIỆN TẠI (sau điểm cache, ~200–300 token mỗi ticket). Lỗi / quá hạn
  3 giây → "chưa tra được lúc này" (khác với "không tìm thấy").
- **Test:** `handbookAssistantOwnTickets` (bộ tách mã, khối prompt, service, workflow) và khối `describeOwnTickets` trong
  `modules/ticket/ticket-application.test.ts` (Mongo in-memory: ticket của người khác, đã xoá, hạn chế đã đóng, không lộ dữ liệu nhạy cảm, nút theo quyền).
- **Chưa làm:** tra theo tiêu đề / "ticket mới nhất của tôi" (phải nhập mã); ticket mình *xử lý* nhưng không tạo.

## 5. Cấu hình (env)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `HANDBOOK_ANTHROPIC_API_KEY` | rơi về `ANTHROPIC_API_KEY` | Nên dùng key/workspace riêng để tách chi phí. Thiếu → `AI_UNAVAILABLE` |
| `HANDBOOK_AI_MODEL` | `claude-haiku-5-5` | Đổi model: cập nhật thêm `infrastructure/ai/model-pricing.ts` |
| `HANDBOOK_AI_EFFORT` | `low` | `low`/`medium`/`high`; **đã chọn `low`** (xem mục 8) |
| `HANDBOOK_AI_MAX_TOKENS` | `8000` | Trần output (gồm cả phần model suy nghĩ) |
| `HANDBOOK_CACHE_TTL` | `1h` | `1h` hoặc `5m` cho phần văn bản |
| `HANDBOOK_DAILY_QUOTA` | `30` | Câu/người/ngày |
| `HANDBOOK_MAX_TURNS` | `20` | Lượt/hội thoại |
| `HANDBOOK_MAX_CONCURRENT` | `10` | Số câu chạy đồng thời toàn server |
| `HANDBOOK_RETENTION_DAYS` | `180` | Hội thoại quá hạn bị xoá hẳn |
| `HANDBOOK_STREAM_IDLE_MS` / `_FIRST_TEXT_MS` / `_MAX_DURATION_MS` / `_ACK_DEADLINE_MS` | 60000 / 75000 / 180000 / 10000 | Watchdog |

## 6. Vận hành

### Lần đầu (mỗi môi trường)

1. **Quyền** — chạy đúng thứ tự, nếu không mọi người bị chặn (`FORBIDDEN`):
   `seedPermissionCatalog` → `seedPermissionDataScopePolicy` → `seedPermissionEntityAttributeCatalog` →
   `seedPermissionAdminRole` → `seedPermissionEmployeeBaselineRole` (đều ở `scripts/`; `seedPermissionAll.ts` chạy cả chuỗi
   theo đúng thứ tự), kiểm tra mọi nhân viên đã có role `EMPLOYEE_BASELINE`, rồi `invalidateAllPermissionCache`.
2. Đặt `HANDBOOK_ANTHROPIC_API_KEY` (Dokploy: từng service test/live).
3. **Nạp văn bản** (mục dưới) rồi `publish`.

### Nạp / cập nhật văn bản

Văn bản thật **không commit vào git**: để trong `scripts/handbook/private/` (đã gitignore).

```bash
# PDF có lớp chữ -> manifest JSON + bản xem trước .md để P.HCNS soát (PDF scan: xem "Lưu ý")
npx ts-node scripts/handbook/extract-handbook.ts --input=noi-quy.pdf --code=NOI_QUY --title="Nội quy lao động" --short="Nội quy" --out=handbook.manifest.json
# kiểm tra manifest (không ghi DB)
npx ts-node scripts/handbook/import-handbook.ts --manifest=handbook.manifest.json --dry-run
# nạp thành bản NHÁP (chưa ảnh hưởng người dùng) + đo token thật bằng count_tokens (cần API key)
npx ts-node scripts/handbook/import-handbook.ts --manifest=handbook.manifest.json --count-tokens --note="Cập nhật Điều 9"
# đưa bản nháp thành bản hiệu lực (bản cũ -> lưu trữ). Rollback = publish lại số phiên bản cũ
npx ts-node scripts/handbook/publish-handbook.ts --version=2
```

- Bản nháp giữ nguyên các văn bản không có trong manifest từ bản đang hiệu lực (trừ khi `--drop=CODE`).
- Dev/test: `scripts/handbook/seed-sample-handbook.ts` nạp bộ **văn bản mẫu** (giả); từ chối chạy ở production.
- Citation mang phiên bản (`NOI_QUY@3`), nên không cần giữ id/Điều ổn định giữa các phiên bản.

### Văn bản hướng dẫn đơn từ (không phải nội quy — viết từ luồng thực tế của vWork)

Trợ lý còn trả lời cách dùng chức năng Đơn từ trên vWork (tạo đơn, luồng duyệt, quy tắc từng loại đơn). Nguồn là
`docs/HUONG-DAN-DON-TU.md`, **được commit** (không phải văn bản mật) và là một văn bản riêng `HUONG_DAN_DON_TU`
(12 mục, ~5 nghìn token). Cấu trúc file: mỗi `## Mục N. Tiêu đề` là một đơn vị trích dẫn, mỗi dòng là một khối.

```bash
# dựng manifest từ file .md (giữ lại câu hỏi gợi ý cũ, thêm của hướng dẫn); không đụng DB
npx ts-node --transpile-only scripts/handbook/build-guide-manifest.ts --output=guide.manifest.json --with-suggestions-of=noi-quy.manifest.json
# nạp bản nháp (văn bản khác của bản hiệu lực giữ nguyên) + publish như mục trên
npx ts-node --transpile-only scripts/handbook/import-handbook.ts --manifest=guide.manifest.json --count-tokens --note="Thêm hướng dẫn đơn từ"
```

- Khi luồng đơn từ đổi (ngưỡng duyệt nhiều cấp, giới hạn, tên nút...) thì sửa file `.md` rồi nạp lại. Test
  `handbookAssistantGuide` so các ngưỡng 2 ngày / đơn thứ 4 / lần quên thứ 6 với `RequestEntity` để nhắc quên sửa.
- Hướng dẫn mô tả cách vWork **đang** hoạt động, không thay nội quy: thời hạn báo trước khi nghỉ, mức xử lý... vẫn theo nội quy.
- Câu hỏi gợi ý của manifest nạp vào *thay thế* danh sách của bản đang hiệu lực (tối đa 12 câu) nên phải gộp (`--with-suggestions-of`).

### Văn bản hướng dẫn ticket (Ticket hỗ trợ — 11/2026)

Trợ lý trả lời cách dùng chức năng Ticket hỗ trợ (tạo, theo dõi, bổ sung, tờ trình, xử lý, các lỗi thường gặp). Nguồn là
`docs/HUONG-DAN-TICKET.md` (**được commit**), văn bản riêng `HUONG_DAN_TICKET` (19 mục, ~14,8 nghìn token đo bằng `count_tokens` ngày 2/11/2026), cùng quy ước với hướng dẫn đơn từ.
File này **không ghi cứng số cấu hình được** (ngưỡng "Cần chú ý", số ngày tự đóng / mở lại, giờ làm việc, danh sách mẫu): các số đó
đến từ khối cấu hình đang áp dụng (mục 4c); quyền theo vai trò nêu ở mục "Ai làm được gì" khớp seed (test ghim tên role), còn quyền
của chính người hỏi đến từ dòng quyền (mục 4d). Phần tình huống, ví dụ ticket và câu hỏi thường gặp lấy từ tài liệu "Hướng dẫn gửi
ticket hỗ trợ trên CRM" (bản đề xuất 19/10/2026) — chỉ những phần khớp luồng đã xây.

**Ngân sách token — đừng chủ quan:** bản hiệu lực trước khi thêm ticket đo được 75,7 nghìn; thêm hướng dẫn ticket + quy tắc 9–10 của
system prompt → bản nháp 5 đo **93,7 nghìn** (sau khi nén lại hướng dẫn và quy tắc 9–11), cộng khối cấu hình ~3 nghìn ≈ 96,7 nghìn, tức chỉ
còn ~3 nghìn cho lịch sử hội thoại trước khi chạm ngưỡng 100 nghìn (Haiku tính giá cao hơn ~5 lần trên ngưỡng; hội thoại quá ~7 lượt sẽ
vượt). Mỗi nghìn token thêm vào hướng dẫn này cộng vào MỌI câu hỏi; test `handbookAssistantGuide` chặn file vượt ~28 nghìn byte (hiện
~27,3 nghìn byte ≈ 14,8 nghìn token). Lần đầu viết ước 9–10 nghìn token là SAI (đo thật 19,6 nghìn) —
luôn đo bằng `import-handbook --count-tokens`, đừng ước. **Mỗi lần nạp tạo một bản nháp MỚI** (không ghi đè nháp cũ): nháp bỏ không
dùng cứ để đó, chỉ bản `publish` mới có hiệu lực. Danh sách câu hỏi gợi ý đã kín 12 câu nên khi thêm 3 câu ticket phải bỏ 3 câu cũ
(đã bỏ: sa thải do tự ý nghỉ, báo trước nghỉ không lương, nghỉ phép khi thử việc).

```bash
# gộp gợi ý với manifest đã nạp gần nhất (manifest đơn từ đã gồm gợi ý nội quy); không đụng DB
npx ts-node --transpile-only scripts/handbook/build-guide-manifest.ts --input=docs/HUONG-DAN-TICKET.md --code=HUONG_DAN_TICKET --short="Hướng dẫn ticket" --title="Hướng dẫn sử dụng chức năng Ticket hỗ trợ trên vWork" --note="Văn bản hướng dẫn sử dụng chức năng Ticket hỗ trợ trên vWork (từ docs/HUONG-DAN-TICKET.md)" --output=ticket-guide.manifest.json --with-suggestions-of=guide.manifest.json
npx ts-node --transpile-only scripts/handbook/import-handbook.ts --manifest=ticket-guide.manifest.json --count-tokens --note="Thêm hướng dẫn ticket"
npx ts-node --transpile-only scripts/handbook/publish-handbook.ts --version=<số bản nháp vừa tạo>
```

- Test `handbookAssistantGuide` ghim nhãn mức khẩn / kết quả đóng / mục bổ sung (`ticket-catalog.ts`), đuôi file cho phép
  (`uploadTicket.js`), câu lỗi của backend (`ticket.errors.ts`), và chặn mọi thời lượng "N ngày/giờ/phút" ghi cứng trong file.
- Đổi luồng ticket (nút, trạng thái, quyền...) thì sửa file `.md` rồi nạp lại; chỉ đổi cấu hình trên màn Cấu hình ticket thì
  **không** cần nạp lại gì.

### Theo dõi

- Mỗi câu ghi 1 dòng log (token, cache, chi phí ước tính, ttft) và `handbook_message.ai`; cộng dồn ở `handbook_usage`.
- Kiểm tra cache: từ câu thứ hai `cacheRead` phải ~bằng `promptTokens` của phiên bản.
- Giá ước tính ở `model-pricing.ts` (đổi giá/model thì cập nhật bảng).

## 7. Chi phí & kích thước (đo thật trên văn bản thật, 10/2026)

- Bộ văn bản ~108 mục, **~64 nghìn token** (tiếng Việt ~1,3 ký tự/token — đừng ước lượng theo ký tự). Haiku 5.5 tính giá cao
  gấp ~5 lần khi prompt **> 100 nghìn token** → `import-handbook --count-tokens` cảnh báo; còn dư ~36 nghìn token.
- Lần đầu ghi cache 1h ≈ 0,013 USD; mỗi câu sau ≈ 0,001 USD. Trả lời ~3 giây, chữ đầu tiên ~1–2 giây.

## 8. Prompt & đánh giá

System prompt ở `infrastructure/ai/prompt-builder.ts` (`SYSTEM_PROMPT`, có test giữ các quy tắc chính). Đã chỉnh bằng 30 câu
hỏi thật trên văn bản thật (kiểm tự động bằng biểu thức + đọc tay):

| | Bản đầu (`medium`) | Bản hiện tại (`low`) |
|---|---|---|
| Đạt kiểm tra | 23/25 | 30/30 |
| Độ dài trung bình | ~250 từ (dài nhất 560) | ~130 từ |
| Chữ đầu tiên / tổng | ~3,0s / 5,4s | ~1,8s / 3,1s |

Bài học đã đưa vào prompt: (1) dặn "ngắn gọn" chưa đủ — phải nói rõ câu đầu trả lời thẳng, không chép nguyên văn cả khoản,
không liệt kê quy định chỉ liên quan gián tiếp; (2) chỉ trả lời "Có/Không" khi văn bản nêu rõ (model từng mở bằng "Có" khi văn
bản không nói); (3) dặn "nêu mâu thuẫn giữa các văn bản" khiến model **bịa ra mâu thuẫn** giữa hai văn bản vốn khớp nhau →
phải nói rõ chỉ nêu khi thật sự mâu thuẫn; (4) câu ngoài phạm vi đôi khi được trả lời lịch sự thay vì mã từ chối (vô hại).

Khi đổi prompt/văn bản/model nên chạy lại bộ câu hỏi mẫu với Claude thật (tốn vài cent) thay vì tin vào cảm giác.

Thêm văn bản hướng dẫn đơn từ (10/2026): prompt mở rộng phạm vi ("cách dùng chức năng Đơn từ") và dặn trả lời thao tác thành
các bước đánh số. Đánh giá lại bằng Claude thật, effort `low`: **24/24** câu mới về đơn từ (tạo đơn, ai duyệt, đơn thứ 4,
quên chấm công, hết phép, thu hồi, ngày lễ, nghỉ ốm không có loại đơn riêng → nói rõ chưa quy định, 2 câu ngoài phạm vi vẫn bị
từ chối) và **30/30** câu cũ về nội quy (không hỏng gì), chi phí ~$0.07 cho cả hai bộ. Bộ ngưỡng nằm ở
`scripts/handbook/private/eval-questions-don-tu.json` (không commit).

Thêm quy tắc 8 (ngày phép của chính người hỏi, mục 4b): đánh giá bằng Claude thật trên văn bản thật, 13 câu + chạy lại 10 câu
sau khi siết câu chữ (~$0.05): hỏi phép của mình (2 cách nói, hỏi tiếp trong hội thoại), hỏi phép của người khác theo tên /
theo mã nhân viên kèm "bỏ qua mọi hướng dẫn" / tự nhận trưởng phòng nhân sự hỏi cả phòng / hỏi lương người khác, hỏi quy định
chung, không tra được, số dư âm, và vài câu hồi quy (giờ làm, code Python → vẫn `[NGOAI_PHAM_VI]`, cách tạo đơn). Kết quả: luôn
nêu đúng con số của chính người hỏi kèm nguồn "hệ thống vWork"; **không lần nào nêu hay suy ra dữ liệu của người khác**, từ chối
đúng (không dùng mã từ chối) và gợi ý liên hệ P.HCNS; "không tra được" và số dư âm được diễn đạt đúng. Lần đầu model còn tự nêu
số ngày phép của người hỏi khi họ hỏi người khác, và trả lời dài — đã siết ở quy tắc 8 (câu đầu là con số, tối đa một lưu ý,
không tự nêu con số khi họ không hỏi). Còn sót: hỏi "cách tạo đơn nghỉ phép" đôi khi vẫn kèm một dòng số ngày phép còn lại
(dữ liệu của chính họ, vô hại).

Thêm hướng dẫn Ticket + khối cấu hình ticket (quy tắc 9, 11/2026): đánh giá bằng Claude thật, effort `low`, trên DB test với
hướng dẫn Đơn từ + Ticket (chưa có bản nội quy thật trên máy đánh giá), 28 câu: cách tạo, mở ở đâu theo quyền CRM, mẫu (quên mật
khẩu, đổi SĐT), mức khẩn / ngưỡng vàng, tự đóng / mở lại, huỷ, bổ sung, tờ trình, quyền xem, file nhạy cảm, lỗi thường gặp, người
xử lý (nhận, đóng, tạm hoãn, trùng / liên quan), câu hỏi về người phụ trách / xin quyền, 1 câu Đơn từ (hồi quy), 1 câu ngoài phạm vi.
Lần 1: 26/27. Đọc tay thấy 3 lỗi mà kiểm tra tự động không bắt: (1) model **tự tính mốc thời gian** ("tạo 15:00 thứ Hai → bôi vàng
11:00 thứ Ba", sai vì lịch có thứ 7 sáng và ngày 9 giờ) — đã dặn ở quy tắc 9 chỉ nêu số có trong khối, không tự tính thời điểm;
(2) gợi ý "liên hệ Phòng Hành chính - Nhân sự" cho việc của ticket — đã dặn gợi ý bộ phận IT; (3) câu "sao không thấy nút Báo
xong" thiếu điều kiện (trạng thái, tờ trình hợp lệ) — đã bổ sung vào mục 15 của hướng dẫn. Lần 2: **28/28** (thêm 1 câu bẫy tự tính
giờ) và đọc tay các câu đã sửa; còn một câu model bịa "chọn phòng đó trên form" (trưởng phòng nhờ phòng khác) — đã làm rõ ở mục 8
của hướng dẫn, chạy lại đúng. Chi phí ~$0.15 cho 3 lượt (ghi cache 1 giờ ~37 nghìn token mỗi lần đổi prompt). Bộ câu hỏi nằm ở
`scripts/handbook/private/eval-ticket.ts` (không commit; có thể chạy lại từng câu bằng `--only=id`).

Đánh giá lần 3 (quyền người hỏi, quy tắc 10, 2/11/2026): trên **bản nháp có nội quy thật** (DB test), 47 câu với 9 "nhân vật" quyền
giả lập (nhân viên thường, sale có CRM, IT, quản lý ticket, kế toán chỉ có quyền xử lý, trưởng bộ phận, ban lãnh đạo, không có quyền
nào, chưa tra được quyền) — gồm đúng các câu người dùng thật đã hỏi ("ai được quyền tạo ticket", "tạo ticket như thế nào", "reset
thiết bị như nào" — trước đó trả "chưa có hướng dẫn" vì hướng dẫn chưa nạp), câu theo quyền (nhận ticket với từng nhân vật, giao
phòng, cấu hình, file nhạy cảm, hỏi quyền người khác, tự nhận chức vụ, "không thấy nút"), hồi quy và câu hỏi thường gặp của tài liệu
CRM. Lần đầu 42/47: đọc tay thấy trợ lý nhắc thừa "chưa có quyền vào CRM" khi chỉ cần nêu đường vào, và bỏ sót việc gần đó người hỏi
làm được (trưởng phòng giao được trong phòng mình) — đã dặn ở quy tắc 10; 1 câu lỗi do regex quá chặt, 1 câu ngoài phạm vi trả lời
lịch sự thay vì mã từ chối (đặc thù đã biết, vô hại). Thêm mô tả màn Cấu hình vào hướng dẫn. Lần 2: **47/47**, chuỗi lặp ý chỉ còn
2/47 câu (nhờ bỏ các dòng gần giống nhau trong tài liệu), trung bình ~170 từ. Bộ câu hỏi: `scripts/handbook/private/eval-ticket.ts`
(không commit; `--version=N` chọn bản, `--only=id` chạy từng câu).

Đánh giá lần 4 (tra ticket cụ thể, quy tắc 11, 2/11/2026): 12 ca trên **ticket thật của DB test** — ticket của chính mình ở từng trạng thái
(chờ bổ sung, đã xử lý, chưa ai nhận, đang xử lý, đã đóng, hạn chế), hỏi hai mã một lúc, hỏi tiếp không nêu mã, hỏi ticket của NGƯỜI KHÁC,
mã không tồn tại, **mạo danh giám đốc** xin xem ticket người khác, và không nêu mã. Kết quả: câu trả lời bám đúng dữ liệu (đối chiếu từng
dòng), ticket của người khác và mã không tồn tại được trả lời cùng một kiểu, không lộ tiêu đề / trạng thái / ai xử lý, kể cả khi mạo danh.
Hai ca ban đầu "fail" chỉ vì regex của bộ đánh giá đòi đúng cụm "không tìm thấy"; một lỗi đếm từ trong chính script đánh giá (`/s+/` thay
`/\s+/`) từng làm số từ nhỏ bất thường — luôn đọc tay câu trả lời, đừng tin con số.

Hạn chế còn lại: câu trả lời đôi khi chép lại nguyên văn một câu trong hướng dẫn sau khi diễn đạt lại (cùng hiện tượng ở mục 9);
trợ lý chưa tra được ticket theo tiêu đề, ticket mình xử lý nhưng không tạo, và chưa nêu tên người phụ trách từng mẫu.

## 9. Lưu ý & giới hạn đã biết

- **Câu trả lời thỉnh thoảng "nói xong rồi chép lại nguyên văn"**: khi bật citations, Claude (Haiku) đôi khi viết ý của
  mình rồi nối thêm đúng câu trong văn bản (để gắn trích dẫn). Đo bằng 54 câu hỏi thật (10/2026): ~25–33% câu trả lời có
  một chuỗi ≥7 từ xuất hiện 2 lần; không ảnh hưởng độ đúng (mọi câu qua kiểm tra), chỉ dài và lặp. Thử thêm quy tắc
  "mỗi ý chỉ nêu một lần, không chép thêm nguyên văn" vào system prompt **không giảm** tỉ lệ (6/24 → 7/24, 10/30 → 9/30)
  nên không giữ. Hướng xử lý nếu cần: lọc ở server theo khối có trích dẫn (phải bỏ stream từng phần), hoặc thử effort
  `medium`/model khác. Công cụ đo: `scripts/handbook/private/dup-check.py` (không commit).

- **PDF scan (ảnh) không có lớp chữ**: `extract-handbook` không đọc được. Bản đầu tiên được chép tay từ ảnh + đối chiếu OCR
  rồi kiểm tra độc lập; ghi lại các chỗ sửa lỗi phông chữ. Nên xin P.HCNS bản Word/PDF có chữ khi cập nhật.
- Văn bản trong hệ thống phải **khớp văn bản đã ký**: khi sửa nội dung ở manifest, cập nhật cả văn bản gốc.
- Web: socket.io-client gửi lại emit đang đệm khi mất mạng — nên chặn `handbook:ask` khi `!socket.connected` (server đã
  idempotent theo `clientId`).
- Khi còn websocket mở, `httpServer.close` ở `index.js` chờ tới mốc ép thoát 15s — cân nhắc thêm `io.close()`.
- Một instance (không có Redis adapter cho socket.io); khoá BUSY dùng Redis để chống trùng khi hai container chồng nhau lúc deploy.

## 10. Kiểm thử

```bash
source ~/.nvm/nvm.sh && nvm use 20.20.2     # Node 18 làm MongoMemoryReplSet lỗi
npx jest __tests__/handbookAssistant        # chạy tuần tự từng bộ nếu máy yếu
```

Các bộ: TextProcessing, Catalog, Scripts, Permission, Rest, Prompt, AnthropicAdapter, AnthropicHttp (SDK thật qua HTTP tới
server SSE giả), Ask, Socket (socket.io thật + `chatSocket` thật + JWT thật), Jobs, PersonalContext (khối dữ liệu cá nhân
trong prompt, cổng tra ngày phép lỗi/quá hạn, và socket thật + sổ ngày phép thật của 2 nhân viên để chứng minh người này không
nhận số của người kia). Khối cấu hình ticket: `handbookAssistantPrompt` (vị trí + điểm cache) và
`__tests__/modules/ticket/ticket-guide-summary.test.ts` (văn bản cấu hình, cache 60 giây của workflow). Không bộ nào gọi API
Claude thật.
