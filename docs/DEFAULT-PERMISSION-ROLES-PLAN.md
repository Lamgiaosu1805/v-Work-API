# Kế hoạch tạo Role/Rule mặc định cho hệ thống phân quyền ABAC

**✅ Phần code đã xong (04-09-2026)** — 5 script role mới đã viết + verify chạy thật trên `v_work_db`
(idempotent, chạy 2 lần cho kết quả giống nhau). Xem mục 5.

Nguồn: `docs/exports/vWork-Permissions-Export.xlsx` (export lúc 15:03:26 03-09-2026 — **đã cũ hơn 1
ngày so với DB test hiện tại**, xem mục 0) + đối chiếu trực tiếp `v_work_db` (test) bằng script tạm
(không lưu lại trong repo) + rà lại route nào đã cutover sang `requirePermission` trong `src/routes/`
và `src/modules/*/interface/`.

Mục tiêu: liệt kê rõ những chỗ hệ thống ABAC hiện KHÔNG có role mặc định nào cấp quyền, và tạo role
cần thiết, theo đúng pattern đã dùng thành công cho CRM (`scripts/seedPermissionCrmRoles.ts`).

---

## 0. File export đã cũ — có sai lệch với DB thật

File Excel ghi "Tổng số role: 4", nhưng lúc phân tích DB `v_work_db` có **14 role** — 10 role rác do
ai đó test UI tạo tay qua màn `PermissionScreen.jsx` (tên như `HE`, `KHKHKJ`, `TEST1`, `TEST_SO_2`,
`CHI_NHAP_TEN_VA_MA`, chuỗi rác 100 ký tự, `K`, `TEST_PHAN_QUYEN`, `SALE_HE_THONG`...). Trong số này,
`TEST_PHAN_QUYEN` đáng chú ý — có đúng 45 grant (khớp số lượng permission HRM) nhưng **0 nhân viên nào
được gán** — rõ ràng là role thử nghiệm, không phải data thật.

**✅ Đã dọn xong (04-09-2026)** — kiểm tra lại thấy cả 10 role rác đã ở trạng thái `isDeleted: true`
(soft-delete, đúng convention `BaseSchema`) — bạn đã tự xoá qua UI trước khi hỏi. Không có role nào
trong số đó đang được gán cho nhân viên nào (verify lại 1 lần nữa trước khi xác nhận xong).

4 role "thật" theo export (`isSystemRole: true`): `PERMISSION_ADMIN`, `CRM_SALE`,
`CRM_SALE_MANAGER`, `CRM_SALE_TEAM_LEAD` — nay có thêm 5 role mới từ mục 2 (xem mục 5).

---

## 1. Phát hiện — xếp theo mức độ nghiêm trọng

### 1.1 🔴 Nghiêm trọng nhất: `request.create`/`view`/`cancel` gần như không ai dùng được

`src/modules/request/interface/request.routes.ts` (module tham chiếu, "hoàn thành" theo CLAUDE.md)
**100% đã cutover sang `requirePermission`** — không còn route legacy nào song song. Kiểm tra trên
`v_work_db`:

- Tổng **73 nhân viên active**.
- Chỉ role `PERMISSION_ADMIN` và `TEST_PHAN_QUYEN` (role rác, 0 người dùng) cấp `request.create`.
- **Chỉ 4/73 nhân viên** có thể tạo/xem/huỷ đơn từ của chính mình qua API này — 69 người còn lại sẽ
  nhận `ForbiddenException` (403) nếu route này đang thật sự được dùng.

Đây gần như chắc chắn là do **`v_work_db` (test) chưa được seed role tương ứng**, trong khi
`v_work_live_db` (production) có thể đã có (theo đúng kỷ luật đã ghi trong
`docs/PERMISSION-MODULE-PLAN.md`/plan CRM trước — seed role luôn phải chạy trên live trước khi route
cutover lên đó). **Chưa verify được trên live** (không có quyền/không nên tự ý đụng `v_work_live_db`
theo giới hạn đã thống nhất) — cần xác nhận lại việc này KHÔNG bị lặp lại trên production trước khi
coi đây là "chỉ là vấn đề DB test".

### 1.2 🟠 `PERMISSION_ADMIN` ("toàn quyền") thật ra thiếu 8 quyền

So khớp toàn bộ `PermissionCatalogModel` (89 mã) với grants của `PERMISSION_ADMIN` (84 grant) —
**8 mã đang KHÔNG được cấp** dù role này mô tả là "Quản trị hệ thống (toàn quyền)":

- `penalty_tier.view`, `penalty_tier.manage`, `penalty_tier.delete` (HRM)
- `customer_call.view`, `customer_call.initiate`, `customer_call.update_relationship_status`,
  `call_log.view`, `call_log.update_note` (CRM — toàn bộ nhóm quyền của module `customer-call`)

**Đã verify thật trong phiên trước**: tài khoản `lamnv` (role legacy = `admin`, có ABAC role
`PERMISSION_ADMIN` + `CRM_SALE_MANAGER`) bị 403 khi gọi `sip-credentials` chính vì lý do này —
`PERMISSION_ADMIN` không tự động bao gồm toàn bộ catalog, nó là 1 danh sách grant tĩnh được seed 1
lần (`scripts/seedPermissionAdminRole.ts`) và **không có cơ chế tự đồng bộ khi catalog có permission
mới** (`penalty_tier.*` và `customer_call.*`/`call_log.*` đều được thêm vào catalog SAU khi
`PERMISSION_ADMIN` đã seed xong, không ai chạy lại script để bổ sung).

→ Đây là lỗ hổng có tính hệ thống: **mỗi khi thêm permission mới vào catalog, phải nhớ chạy lại seed
`PERMISSION_ADMIN`** — hiện không có gì nhắc việc này, dễ tái diễn.

### 1.3 🟠 HRM: 5/6 tài khoản có `module_access: ["hrm"]` không có role ABAC nào

```
module_access=hrm: 6 account — user/own=3, manager/all=2, manager/own=1
→ 5/6 KHÔNG có EmployeePermissionProfile / roleIds rỗng
```

**Route HRM đã cutover sang `requirePermission`** (grep xác nhận): `attendance.js`, `department.js`,
`holiday.js`, `user.js`, `laborContract.js`, `branch.js`, `document.js`, `employmentStatus.js`,
`attendanceMapping.js`, `kpiMetric.js`, `dashboard.js`. Không có role HRM nào được seed từ trước
(`scripts/` không có `seedPermissionHrmRoles.ts` hay tương đương) — **đúng bug class giống CRM đã gặp
lúc đầu** (32 account CRM mất quyền trước khi seed `seedPermissionCrmRoles.ts`), nhưng lần này chưa
ai xử lý.

### 1.4 🟡 Workplace: 3/3 tài khoản `module_access: ["workplace"]` cũng chưa có role nào cấp gì

```
module_access=workplace: 3 account — manager/all=2, manager/own=1
```

Chưa có `seedPermissionWorkplaceRoles.ts` nào. Mức độ ưu tiên thấp hơn HRM vì phần lớn tính năng
Workplace cơ bản (xem bảng tin, nộp báo cáo tuần của phòng mình) không yêu cầu `module_access` theo
CLAUDE.md — chỉ phần quản lý (`canMgr("workplace")`) mới cần, và tuỳ route đã cutover chưa (`kpiMetric.js`,
`dashboard.js` đã cutover — 2/3 người này có thể đang bị ảnh hưởng).

### 1.5 🟢 CRM: cơ bản ổn, còn 5 quyền chưa role nào cấp (rủi ro thấp)

`ai_chat.use`, `app_integration.manage`, `customer_claim_request.revoke`, `transaction.create`,
`transaction.view` — không nằm trong `SALE_GRANTS`/`TEAM_LEAD_GRANTS`/`SALE_MANAGER_GRANTS`. Rủi ro
thấp vì route tương ứng (`transactionManagement.js`, `ai.js`) **theo đúng plan trước đó cố tình chưa
cutover** sang `requirePermission` (vẫn dùng `hasModuleAccess` cũ) — nên hiện KHÔNG có ai bị khoá
thật, chỉ là catalog có sẵn nhưng chưa dùng tới.

---

## 2. Đề xuất role mặc định cần tạo

Dựa theo đúng bảng "Ví dụ thực tế" đã có sẵn trong `CLAUDE.md` (role/module_access/dept_scope) —
dùng làm khung thiết kế, mỗi tổ hợp (role × module × dept_scope) tương ứng 1 role ABAC, giống cách
`CRM_SALE`/`CRM_SALE_MANAGER`/`CRM_SALE_TEAM_LEAD` đã làm cho CRM.

### 2.1 `EMPLOYEE_BASELINE` — ưu tiên cao nhất, gán cho TẤT CẢ nhân viên ✅ Đã tạo role

Giải quyết mục 1.1. Không phụ thuộc `module_access` — mọi nhân viên trong công ty đều cần các quyền
tự-phục-vụ cơ bản:

| Permission | Data Scope đề xuất |
|---|---|
| `request.create` | `REQUEST_SELF` |
| `request.view` | `REQUEST_SELF` |
| `request.cancel` | `REQUEST_SELF` |
| `employee.view` | `EMPLOYEE_SELF` (xem hồ sơ chính mình) |
| `post.view` | `POST_ALL_COMPANY` (bảng tin công ty) |
| `post_comment.create` | `POST_COMMENT_ALL_COMPANY` |

**Cần chốt:** có nên gộp thêm `weekly_report.submit` (own department) vào baseline không, hay tách
riêng vì không phải ai cũng thuộc 1 phòng ban có trách nhiệm nộp báo cáo tuần? Đề xuất: tách riêng,
để tránh cấp nhầm quyền cho người không cần.

### 2.2 `HRM_STAFF` — mirror "HR nhân viên" (`user`/`["hrm"]`/`all`) ✅ Đã tạo role (10 quyền)

Quyền `.view` (đọc) cấp `ALL_COMPANY`, phục vụ xử lý nghiệp vụ HR hàng ngày (không gồm quyền
tạo/sửa/xoá cấu hình hệ thống):

`employee.view`, `department.view`, `position.view`, `holiday.view`, `attendance.view`,
`employment_status.view`, `branch.view`, `document.view`, `weekly_report.view`, `request.view`
(để HR theo dõi đơn từ toàn công ty, không phải để duyệt).

**Cần chốt với BA/bạn:** danh sách trên là suy luận từ tên quyền, chưa chắc đúng thực tế nghiệp vụ —
ví dụ `document.view`/`payroll.view` có nên nằm ở tier "nhân viên" hay phải lên tier "manager"?

### 2.3 `HRM_MANAGER` — mirror "HR manager" (`manager`/`["hrm"]`/`all`) ✅ Đã tạo role (43 quyền)

Toàn bộ quyền HRM ở scope `ALL_COMPANY`, gồm cả `.manage`/`.delete`/`.create`/`.set_status` — tương tự
cách `CRM_SALE_MANAGER` được cấp toàn bộ quyền ALL_COMPANY của CRM. Trừ `request.create`/`.cancel`
(đã có ở `EMPLOYEE_BASELINE`).

### 2.4 `DEPT_MANAGER_HRM_WORKPLACE` — mirror "IT head" (`manager`/`["hrm","workplace"]`/`own`) ✅ Đã tạo role (15 quyền)

Quyền quản lý **trong phạm vi phòng ban mình** — dùng Data Scope `OWN_DEPARTMENT` cho các entity có
hỗ trợ (`employee.*`, `internal_file.*`, `weekly_report.*`) + `.view` read-only `ALL_COMPANY` cho dữ
liệu tham chiếu chung (holiday/position/branch/shift_config/employment_status/document).

**Xác nhận thật khi code**: `REQUEST` chỉ có `REQUEST_SELF`/`REQUEST_ALL_COMPANY`, **không có**
`REQUEST_OWN_DEPARTMENT` — nên role này **không có `request.review`** (tránh over-grant thành duyệt
toàn công ty). Không có quyền Workplace nào — toàn bộ entity Workplace trong catalog chỉ hỗ trợ
`ALL_COMPANY`/`SELF_ASSIGNED`, không có bản "own department" nào cả.

### 2.5 `WORKPLACE_MANAGER_ALL` ✅ Đã tạo role (16 quyền) — bỏ `WORKPLACE_MANAGER_OWN`

**Xác nhận thật khi code**: không tạo được `WORKPLACE_MANAGER_OWN` — không có Data Scope Policy nào
kiểu "cùng phòng ban" cho bất kỳ entity Workplace nào trong catalog hiện tại (`kpi_metric`, `post`,
`post_comment`, `print_job`, `shared_folder*` đều chỉ có `ALL_COMPANY`/`SELF_ASSIGNED`). Muốn có role
này cần bổ sung Data Scope Policy mới trước (nằm ngoài phạm vi "chỉ tạo role" của đợt này).

### 2.6 Fix `PERMISSION_ADMIN` thiếu 8 grant (mục 1.2) ✅ Tự hết, đã verify thật

Không cần sửa code — `seedPermissionAdminRole.ts`'s `buildFullGrants()` tự quét lại toàn bộ
`PermissionCatalogModel` mỗi lần chạy. Đã verify trên `v_work_db`: chạy lại script này, `PERMISSION_ADMIN`
tự động cập nhật từ 84 → **89 permission** (đủ toàn bộ catalog).

---

## 3. Câu hỏi cần chốt trước khi code

- [ ] **Ưu tiên số 1**: xác nhận `v_work_live_db` có đúng đang bị lỗ hổng `request.*` như test DB
      không, hay chỉ là test DB chưa được seed lại sau lần setup ban đầu. Nếu production cũng thiếu —
      đây là incident cần xử lý ngay, không đợi kế hoạch đầy đủ.
- [ ] Danh sách quyền cụ thể cho `HRM_STAFF` (mục 2.2) — cần xác nhận với BA, hiện tôi tự suy luận từ
      tên quyền, không có căn cứ nghiệp vụ chắc chắn.
- [ ] `REQUEST` entity có cần thêm Data Scope Policy `REQUEST_OWN_DEPARTMENT` (cho `request.review`
      cấp phòng ban) không — hiện export chỉ thấy `REQUEST_SELF`/`REQUEST_ALL_COMPANY`, nghĩa là
      "duyệt đơn" hiện chỉ có 2 mức (chỉ đơn mình / toàn công ty), không có mức "phòng ban mình" như
      các entity khác — có thể là thiết kế cố ý (ai duyệt đơn phải là admin-tier) hoặc là gap.
- [ ] Có cần dọn 10 role rác trong DB test không (mục 0) — không ảnh hưởng chức năng nhưng gây nhiễu
      khi tra cứu/debug.
- [ ] Sau khi 2 role/việc ở mục 2.1 và 2.6 được duyệt, có nên ưu tiên làm 2 việc đó trước (rủi ro thật,
      ảnh hưởng người dùng thật) rồi mới làm HRM/Workplace đầy đủ (mục 2.2–2.5, cần nhiều xác nhận
      nghiệp vụ hơn)?

## 4. Đề xuất thứ tự triển khai (chờ duyệt)

1. Xác nhận tình trạng `v_work_live_db` cho vấn đề `request.*` (mục 1.1) — nếu live cũng thiếu, xử lý
   như incident riêng trước.
2. `EMPLOYEE_BASELINE` (mục 2.1) + fix `PERMISSION_ADMIN` thiếu 8 grant (mục 2.6) — 2 việc rủi ro thấp,
   không cần chốt thêm nghiệp vụ, làm được ngay.
3. `HRM_STAFF`/`HRM_MANAGER` (mục 2.2/2.3) — sau khi có xác nhận danh sách quyền từ BA.
4. `DEPT_MANAGER_HRM_WORKPLACE` (mục 2.4) — sau khi rõ có cần thêm Data Scope Policy mới cho `Request`
   hay không.
5. `WORKPLACE_MANAGER_ALL`/`WORKPLACE_MANAGER_OWN` (mục 2.5).
6. Dọn role rác (mục 0) — làm cuối, không gấp.

---

## 5. Kết quả triển khai (04-09-2026)

**Đã viết 5 script role mới** (theo đúng convention `seedPermission*Role.ts` sẵn có, mỗi script CHỈ
tạo/cập nhật định nghĩa role — **không tự gán cho nhân viên nào**, theo đúng yêu cầu "viết seed, tự
gán trên hệ thống"):

| Script | Role code | Số quyền |
|---|---|---|
| `scripts/seedPermissionEmployeeBaselineRole.ts` | `EMPLOYEE_BASELINE` | 6 |
| `scripts/seedPermissionHrmStaffRole.ts` | `HRM_STAFF` | 10 |
| `scripts/seedPermissionHrmManagerRole.ts` | `HRM_MANAGER` | 43 |
| `scripts/seedPermissionDeptManagerHrmWorkplaceRole.ts` | `DEPT_MANAGER_HRM_WORKPLACE` | 15 |
| `scripts/seedPermissionWorkplaceManagerRole.ts` | `WORKPLACE_MANAGER_ALL` | 16 |

**Script tổng hợp mới**: `scripts/seedPermissionAll.ts` — chạy tuần tự toàn bộ 10 script seed
permission theo đúng thứ tự dependency (catalog → data scope → entity attribute → admin role → CRM
roles → 5 role mới ở trên), dừng ngay nếu 1 script lỗi. Cách chạy:

```bash
npx ts-node --transpile-only scripts/seedPermissionAll.ts
```

**Đã verify thật trên `v_work_db`** (test): chạy 2 lần liên tiếp — lần 1 tạo 5 role mới + cập nhật
`PERMISSION_ADMIN` từ 84 → 89 permission (xác nhận mục 2.6 tự hết, không cần sửa code); lần 2 toàn
bộ đều "bỏ qua (đã đúng)" — xác nhận cả chuỗi 10 script idempotent, an toàn chạy lại nhiều lần kể cả
trên production.

**Việc còn lại (không phải code — bạn tự làm theo đã nói):**
- Gán 5 role mới cho nhân viên thật qua màn Phân quyền.
- Xác nhận `v_work_live_db` có cùng tình trạng thiếu `request.*`/8 grant admin như test không, trước
  khi chạy `seedPermissionAll.ts` trên production.
- `WORKPLACE_MANAGER_OWN` và `request.review` cấp phòng ban (trong `DEPT_MANAGER_HRM_WORKPLACE`) vẫn
  chưa làm được — cần thêm Data Scope Policy mới trước (nằm ngoài phạm vi đợt này).
