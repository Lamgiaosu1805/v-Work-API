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

## 9. Lưu ý & giới hạn đã biết

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
server SSE giả), Ask, Socket (socket.io thật + `chatSocket` thật + JWT thật), Jobs. Không bộ nào gọi API Claude thật.
