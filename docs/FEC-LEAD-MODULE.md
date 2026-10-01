# Module `fec-lead` — nhận khoản vay FE Credit từ VNFITE

Nhận dữ liệu khoản vay FE Credit do VNFITE đẩy sang (một chiều, VNFITE → vWork) qua
`POST /fec-lead/upsert`. Mỗi request là toàn bộ trạng thái hiện tại của 1 khoản vay, không phải diff.

## Route

```
POST /fec-lead/upsert
x-api-key: <dùng chung client "vnfite" đã có sẵn trong verifyInternalRequest>
```

- Thành công / trùng `event_id` / version cũ đến muộn → luôn `200`.
- Thiếu field bắt buộc → `400`.
- Không tìm thấy customer theo `external_id` → `404`.

## Models (`src/models/`)

| Model | Collection | Vai trò |
|---|---|---|
| `FecLeadModel` | `fec_lead` | Trạng thái **hiện tại** (mới nhất) của khoản vay — 1 document / `lead_gen_id` (unique). Ghi đè mỗi lần nhận version mới hơn. Có field `commission_status` (`pending`/`calculated`) để theo dõi đã tính hoa hồng chưa. |
| `FecLeadEventModel` | `fec_lead_event` | Sổ chống trùng `event_id` — không phải dữ liệu nghiệp vụ. `event_id` unique index; request gửi lại trùng `event_id` sẽ bị chặn ngay từ đây. |
| `FecLeadVersionModel` | `fec_lead_version` | Lịch sử: mỗi lần 1 version được áp dụng thật (`created`/`updated`, không tính `skipped_stale_version`) thì lưu thêm 1 bản snapshot gọn (stage, current_status, số tiền...) kèm `version` + `applied_at`. Không lưu lại `history[]` (đã có sẵn, tự phình to theo thời gian trong `FecLeadModel`) để tránh nhân bản dữ liệu. |

## Module `src/modules/fec-lead/` (DDD/Hexagonal)

### `domain/`
- `types.ts` — `FecLeadProps`, `FecLeadHistoryItem` (shape dữ liệu của aggregate).
- `fec-lead.entity.ts` — `FecLeadEntity` (AggregateRoot). `create()` khởi tạo mới; `applyUpdate(newProps)`
  so `version` mới với `version` đang lưu — cũ hơn thì trả `{applied:false}` (bỏ qua êm, không phải
  lỗi), mới hơn/bằng thì ghi đè và tự bắn domain event nếu `stage` **chuyển sang** `COMPLETED` lần đầu.
- `domain/events/fec-lead-completed.domain-event.ts` — `FecLeadCompletedDomainEvent`, mang theo
  `leadGenId` + `customerId`.

### `infrastructure/`
- `fec-lead.mapper.ts` — chuyển đổi `FecLeadDoc` (Mongoose) ↔ `FecLeadEntity` (domain).
- `fec-lead.repository.ts` — `extends MongooseRepositoryBase`. Ngoài `insert`/`updateById` kế thừa,
  có thêm: `findByLeadGenId`, `findCompletedPendingCommission` (phục vụ job rà soát),
  `markCommissionCalculated`.

### `application/`
- `upsert-fec-lead.service.ts` — use-case chính `upsertFecLead(input)`: validate field bắt buộc →
  check `event_id` trùng (ngoài transaction, vì VNFITE gọi tuần tự) → trong 1 transaction: tra
  customer theo `external_id` (404 nếu không có) → tìm/tạo/update `FecLeadEntity` → ghi nhận
  `event_id` đã xử lý → ghi snapshot vào `FecLeadVersionModel` → commit → publish domain event
  (fire-and-forget, sau khi đã commit).
- `fec-lead-commission.handler.ts` — side-effect hoa hồng. `processFecLeadCommission()` là logic xử
  lý thật (**hiện chỉ log, chưa tính tiền** — công thức hoa hồng FE Credit chưa được xác nhận với
  business, khác công thức Investment). Dùng chung bởi 2 nơi:
  - lắng nghe `FecLeadCompletedDomainEvent` qua `eventBus.on(...)` (đường real-time).
  - `reconcileFecLeadCommission()` — quét toàn bộ lead `COMPLETED` nhưng `commission_status` còn
    `pending`, gọi lại `processFecLeadCommission` cho từng cái (đường an toàn dự phòng, không phụ
    thuộc việc publish event ở trên có thành công hay không — xem mục Cron job bên dưới).

### `interface/`
- `fec-lead.http.controller.ts` — bóc payload JSON lồng nhau (`body.customer.external_id`,
  `body.lead.*`) thành input phẳng cho service, validate sớm 2 field bắt buộc nhất để trả 400 sớm.
- `fec-lead.routes.ts` — `POST /upsert`, gate bằng `verifyInternalRequest` (không phải `authenticate`
  — đây là app nội bộ gọi bằng API key, không phải user đăng nhập).

### `index.ts`
Public API của module — chỉ export `upsertFecLead` (+ types) và `reconcileFecLeadCommission`. Không
export Entity/Repository ra ngoài, đúng convention DDD của dự án.

## Cron job (`src/jobs/reconcileFecLeadCommission.js`)

Chạy mỗi 30 phút, gọi `reconcileFecLeadCommission()`. Lý do cần job này: việc publish domain event
trong dự án là **fire-and-forget** (`.catch(() => {})`, convention chung toàn dự án, không riêng module
này) — nếu handler tính hoa hồng lỗi hoặc publish event thất bại, lead vẫn lưu đúng `COMPLETED` nhưng
không ai biết hoa hồng chưa được xử lý. Job này quét định kỳ các lead `COMPLETED` còn
`commission_status: "pending"` để xử lý lại — đảm bảo không bỏ sót, kể cả những lead `COMPLETED` **từ
trước khi công thức hoa hồng thật được triển khai** (vì handler hiện tại không tự đánh dấu
`"calculated"` khi chưa tính được gì thật).

Đăng ký tại `src/jobs/index.js` → `registerReconcileFecLeadCommissionJob()`.

## Việc còn thiếu / cần làm tiếp

- **Công thức hoa hồng FE Credit** chưa được xác nhận với business — `processFecLeadCommission()`
  hiện chỉ log, chưa ghi nhận/tính tiền thật. Khi có công thức: implement tại đây, dùng `customerId`
  để tìm sale phụ trách (qua `ref_code` và/hoặc `fec_referral_code`), rồi gọi
  `fecLeadRepository.markCommissionCalculated(leadGenId)` sau khi tính xong để job rà soát không xử
  lý lại.
- Chưa có màn hình/API cho sale xem danh sách `FecLead` đang phụ trách (chỉ mới có chiều ghi từ
  VNFITE vào).
