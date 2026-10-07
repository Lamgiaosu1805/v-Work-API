# API `/customer-care` — phân khách & SLA chăm sóc (Quy định 183A)

Thiết kế + quy tắc nghiệp vụ: `CRM-CUSTOMER-CARE-SLA-PLAN.md`. Mọi route cần `Authorization: Bearer`.
Lỗi trả `{ message }` với 400/403/404/409. Thời gian trả về là ISO string (UTC) — client tự hiển thị giờ VN.
`appCode` mặc định `tikluy`.

## Quyền (permission code, entity `Customer`)

| Code | Ai có (seed) | Dùng cho |
|---|---|---|
| `customer_care.view` | Sale (chỉ khách mình), Trưởng nhóm (phòng mình), Quản lý Sale | Màn "Khách cần xử lý" |
| `customer_care.manage` | Trưởng nhóm (phòng mình), Quản lý Sale (toàn công ty) | Màn điều phối/dashboard |
| `customer_care.policy` | Quản lý Sale, Admin | Màn cấu hình chính sách |
| `customer.export` | Trưởng nhóm, Quản lý Sale | Nút "Xuất Excel" khách hàng (Sale thường không còn quyền) |

Kho chung (`/pool`) chỉ trả dữ liệu khi `customer_care.manage` phạm vi toàn công ty (khác → 403).

## Sale

### `GET /customer-care/my-queue`
```json
{
  "message": "OK",
  "server_time": "2026-10-07T02:05:00.000Z",
  "summary": { "total": 3, "not_contacted": 1, "overdue": 1, "appointments_today": 0 },
  "data": [{
    "_id": "...", "round": 1, "channel": "auto|manual|referral|claim",
    "priority_class": "A|B",
    "assigned_at": "...", "first_contact_due_at": "...", "warn_at": "...", "revoke_at": "...",
    "inactivity_due_at": "...", "first_contact_at": null, "first_contact_breached": false,
    "last_valid_activity_at": null, "attempt_count": 0, "appointment_at": null,
    "auto_revoke": true, "warned_at": null,
    "sla_state": "waiting_first_contact|warning|overdue|in_care|inactive_due",
    "customer_id": { "_id": "...", "phone_number": "09...", "external_id": "...", "status": "registered|kyc_verified|...",
                     "source_type": "marketing|sale|agent", "registeredAt": "...", "identity": { "full_name": "..." } }
  }]
}
```
- Đếm ngược: nếu `first_contact_at == null` → còn `first_contact_due_at - now` để liên hệ lần đầu; khách bị
  thu hồi lúc `revoke_at` (chỉ khi `auto_revoke`). Nếu đã liên hệ → hạn hoạt động hợp lệ tiếp theo là
  `inactivity_due_at`. Nên tính `now` lệch theo `server_time` để tránh lệch đồng hồ máy.
- Nhóm A = đã eKYC chưa đầu tư (gọi ngay ≤ 5 phút), B = chưa eKYC (≤ 15 phút).

### `GET /customer-care/customers/:customerId/history`  (`customer_care.view` hoặc `.manage`)
`{ data: { state: {pool_status, priority_class, round_count, current_sale_id:{full_name,ma_nv}, ...} | null,
history: [lượt giao như trên + sale_id:{full_name, ma_nv}, status, ended_at, ended_reason, end_note] } }`

`ended_reason`: `revoked_no_contact` (không liên hệ đúng SLA), `revoked_inactive` (không chăm sóc hợp lệ),
`revoked_manual` (quản lý thu hồi), `sale_offboarded` (Sale nghỉ/bị khoá), `reassigned` (chuyển Sale),
`claimed` (yêu cầu nhận khách được duyệt), `converted` (khách đã đầu tư).

### Báo cáo chăm sóc (route cũ, đã bật lại): `POST /customer/interactions/:externalId`
Quyền `customer_interaction.create`. Body:
```json
{
  "type": "call|message|meeting",
  "contact_result": "connected|no_answer|busy|wrong_number|callback_requested|message_replied",
  "customer_need": "string",
  "result": "interested|not_interested|need_more_info|will_invest|invested|no_answer",
  "next_action": { "description": "bước tiếp theo", "due_date": "ISO (lịch hẹn, tuỳ chọn)" },
  "lost_reason": "no_need|not_eligible|product_mismatch|competitor|unreachable|wrong_contact|other",
  "content": "ghi chú thêm (tuỳ chọn, ≤ 2000)",
  "call_log_id": "tuỳ chọn — id cuộc gọi vừa kết thúc"
}
```
Khi khách đang được giao cho chính Sale gửi báo cáo: BẮT BUỘC `contact_result`, `customer_need`, `result`
(= trạng thái hiện tại), và `next_action.description` (nếu `result = not_interested` thì thay bằng
`lost_reason`). Thiếu → 400 `{ message, missing_fields: [...] }`. Báo cáo đủ = hoạt động hợp lệ; có
`due_date` tương lai = lịch hẹn (gia hạn mốc thu hồi).

Nhãn tiếng Việt gợi ý:
- contact_result: Nghe máy / Không nghe máy / Máy bận / Sai số / Hẹn gọi lại / Đã phản hồi tin nhắn
- result: Quan tâm / Không quan tâm / Cần thêm thông tin / Sẽ đầu tư / Đã đầu tư / Chưa liên hệ được
- lost_reason: Không có nhu cầu / Không đủ điều kiện / Sản phẩm không phù hợp / Dùng sản phẩm khác /
  Không liên lạc được / Sai thông tin liên hệ / Khác

`GET /customer/interactions/:externalId?page=&limit=&reportsOnly=true` (quyền `customer_interaction.view`)
→ `{ data: [...], pagination: { total, page, limit, total_pages } }` (mặc định kèm log hệ thống: giao/thu hồi).

### Socket (sau cuộc gọi tổng đài)
Room `user:<userInfoId>` nhận `customer_call:ended` (và `customer_call:rate` cũ) với
`{ callLogId, customerId, phoneNumber, direction, duration }` → mở form báo cáo chăm sóc.

### Push notification (`type` trong data)
`customer_care_assigned` (được giao khách), `customer_care_sla_warning` (cảnh báo SLA),
`customer_care_revoked` (bị thu hồi). `data.customerId`, `uri: "/crm/khach-can-xu-ly"`.

## Quản lý (`customer_care.manage`)

### `GET /customer-care/dashboard?appCode=&from=&to=`  (mặc định 7 ngày gần nhất)
```json
{ "data": {
  "pool": { "in_pool": { "A": 2, "B": 5 }, "nurturing": 3 } ,          // null nếu không phải phạm vi toàn công ty
  "current": { "active": 12, "not_contacted": 2, "overdue_first_contact": 1 },
  "period": { "assigned": 40, "contacted": 37, "contacted_on_time": 33, "revoked": 4, "converted": 6,
              "on_time_rate": 0.825, "conversion_rate": 0.15 },
  "by_sale": [{ "sale_id": "...", "sale": { "full_name": "...", "ma_nv": "..." }, "active": 5,
                "assigned_today": 2, "assigned_in_period": 10, "overdue_now": 0, "revoked": 1,
                "converted": 2, "on_time_rate": 0.9 }]
}, "range": { "from": "...", "to": "..." } }
```

### `GET /customer-care/assignments?appCode=&saleId=&status=active|ended&endedReason=revoked|<reason>&breachedOnly=true&from=&to=&page=&limit=`
`{ data: [lượt giao + customer_id{...} + sale_id{full_name,ma_nv}], total, page, limit }`

### `GET /customer-care/pool?appCode=&poolStatus=in_pool|nurturing|excluded&priorityClass=A|B|C&page=&limit=`
`{ data: [{ _id, customer_id:{...}, pool_status, priority_class, round_count, entered_pool_at,
previous_sale_ids, status_reason, low_priority }], total, page, limit }`
`low_priority: true` = khách dưới 18 tuổi (theo eKYC) — phân sau mọi khách khác.

### `GET /customer-care/sales?appCode=`
```json
{ "data": [{ "sale_id": "...", "full_name": "...", "ma_nv": "...", "role_name": "Sale", "rank": "C",
  "allocation_status": "open|paused|locked", "reason": null, "until": null,
  "on_leave": false, "resigned": false,
  "cap_new_per_day": 10, "cap_total": 50, "new_today": 3, "active_load": 12, "remaining_today": 7,
  "is_full": false, "receiving_state": "receiving|full|paused|locked|on_leave|resigned",
  "receiving": true, "last_assigned_at": "..." }] }
```

### `PATCH /customer-care/sales/:saleId/allocation`
Body: `{ "status": "open|paused|locked", "reason": "bắt buộc khi paused/locked", "until": "ISO tuỳ chọn (paused)",
"capNewPerDay": number|null, "capTotal": number|null }` (gửi field nào đổi field đó; `null` = về mặc định theo hạng).

### Điều phối khách
- `POST /customer-care/customers/:customerId/assign` `{ sale_id, reason }` — phân tay; nếu khách đang có Sale thì
  là chuyển Sale và `reason` bắt buộc.
- `POST /customer-care/customers/:customerId/revoke` `{ reason }` (bắt buộc) — thu hồi về kho chung (hoặc CSKH
  nếu đã đủ 2 vòng).
- `POST /customer-care/customers/:customerId/return-to-pool` `{ reason }` — khách CSKH nuôi dưỡng / bị loại → kho.
- `POST /customer-care/customers/:customerId/exclude` `{ reason }` (bắt buộc) — loại khỏi kho chung.

## Cấu hình
- `GET /customer-care/policy?appCode=` (`.manage`) → `{ data: { appCode, enabled, configured, version, updatedAt,
  sla: { A: {firstContactMinutes, warnMinutes, revokeMinutes, inactivityMinutes, minAttemptsIfNotConnected}, B: {...} },
  validCallMinAnswerSec, maxSaleRounds, appointmentGraceMinutes,
  capacityByRank: { A:{newPerDay,total}, B, C, D }, defaultRank, autoRevokeReferral, workStartMinute, workEndMinute } }`
- `PUT /customer-care/policy/:appCode` (`.policy`) — body là patch cùng shape (camelCase), server validate.
  Mọi mốc phút là PHÚT LÀM VIỆC (ca 8:00–17:00 = 540 phút/ngày).

## Thay đổi ở API cũ cần lưu ý phía client
- `GET /customer/export-excel` cần thêm quyền `customer.export`.
- `GET /claim-period/status?app_code=tikluy` trả `{ is_open:false, auto_allocation:true, message }` khi app đã bật
  phân tự động; các route claim-period khác trả 409 → ẩn chức năng "Đợt nhận khách" cho app này.
- `POST /customer-claim-request` (yêu cầu nhận khách) giờ được phép cả khi khách đang do hệ thống phân.
