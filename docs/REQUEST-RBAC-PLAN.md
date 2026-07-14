# Plan: Áp dụng RBAC cho Request + seed quyền + merge chấm công min/max

## 1. Bối cảnh

Dự án đã có hệ thống RBAC mới (`Permission`/`Role`/`RolePermission`/`UserRole`/`UserPermission` + `requirePermission`/`can` trong `src/helpers/rbac.js`), hiện mới dùng cho module KPI. Yêu cầu đợt này:

1. Áp dụng RBAC cho `RequestController.js` — **admin và nhân sự (HR) xem được toàn bộ đơn** (mọi loại đơn).
2. Viết seed script cho permission (hiện **chưa có seeder nào** cho RBAC).
3. Rà soát bug logic request — đã phát hiện: admin bypass bị comment out ở `getAll`/`review`, filter ngày sai timezone, `checkIn`/`checkOut` thiếu `isDeleted:false`.
4. Merge conflict máy chấm công (excel) vs app: **checkin sớm nhất, checkout muộn nhất** (hiện tại excel ưu tiên tuyệt đối, chỉ fallback sang app khi excel thiếu).

**Quyết định đã chốt:**
- `view_all` áp dụng **tất cả loại đơn**; HR **chỉ xem**, không duyệt.
- `review` bỏ hẳn check theo role: duyệt theo **quan hệ được gán** (`assigned_reviewer`), override bằng permission `hrm.request.review_all` (admin auto-pass qua `can()`). Vẫn **chặn tự duyệt với tất cả, kể cả admin**.
- Seed cả permissions + role `hr` gắn sẵn quyền; gán role cho account qua API RBAC admin có sẵn (`POST /rbac/users/:accountId/roles`). `review_all` vào catalogue nhưng **chưa gán cho role nào** — gán sau qua API khi có nhu cầu.
- Sửa bug timezone + isDeleted; **giữ nguyên** rule `MIN_GAP_MINUTES = 120`.

**Framework phân tầng authz (rút ra sau review):** route middleware = gate nhị phân theo token · permission (`can`) = năng lực gán được qua data · quan hệ trên document = ownership/assignment, check trong controller · role = chỉ là admin escape-hatch trong `can()`, không rải ra code.

## 2. Các bước triển khai

### Bước 1 — Thêm permission constant

**File:** `src/constants/permissions.js`

Thêm vào map `PERMISSION`:
```js
HRM_REQUEST_VIEW_ALL: "hrm.request.view_all",
HRM_REQUEST_REVIEW_ALL: "hrm.request.review_all"
```
`PERMISSION_VALUES` và barrel `src/constants/index.js` tự nhận, không cần sửa gì thêm. (`review_all` ban đầu định bỏ vì "chưa dùng", nhưng thiết kế cuối của `review` dùng nó trong `can()` nên không còn là permission chết.)

### Bước 2 — Refactor RequestController

**File:** `src/controllers/RequestController.js`

Thêm import đầu file: `moment-timezone`, `{ can }` từ `../helpers/rbac`, `{ PERMISSION, ROLE }` từ `../constants`, hằng `TZ = "Asia/Ho_Chi_Minh"`.

**2a. `getAll` (dòng 183–248):** dùng `can()` inline trong controller (không dùng `requirePermission` ở route vì cần branching 3 nhánh). Thay dòng 185–203:

- `const hasViewAll = await can(req.account, PERMISSION.HRM_REQUEST_VIEW_ALL)` — admin tự pass qua bypass trong `can()`, HR pass qua role `hr`.
- **Check `hasViewAll` TRƯỚC check `role === "user"`** — vì account HR thường mang role `"user"`.
- Nếu `hasViewAll` → không filter `assigned_reviewer` (thấy tất cả đơn, mọi loại).
- Nếu không: role `user` → 403; manager → lookup `managerInfo` và filter `assigned_reviewer = managerInfo._id` như cũ. Lookup `managerInfo` chuyển vào nhánh này — tiện thể sửa luôn bug admin không có `UserInfo` bị 404.

**2b. `review` (dòng 250–355):** **bỏ hẳn check role ở đầu hàm** — authorization thật là quan hệ `assigned_reviewer` + permission override:
```js
// Chặn tự duyệt — áp dụng cho TẤT CẢ, kể cả admin
if (request.user_id.equals(reviewerInfo._id)) → 403
// Duyệt theo quan hệ được gán; review_all cho phép duyệt mọi đơn (admin auto-pass qua can)
const canReviewAll = await can(req.account, PERMISSION.HRM_REQUEST_REVIEW_ALL);
if (!canReviewAll && !request.assigned_reviewer.equals(reviewerInfo._id)) → 403
```
Lý do bỏ gate role: nếu giữ `role === "user"` → 403 ở đầu thì HR lead (role `user`) được gán `review_all` sau này vẫn bị chặn trước khi permission được xét — hai cơ chế mâu thuẫn nhau. User thường không được gán duyệt sẽ rơi vào 403 "không được chỉ định", đúng ngữ nghĩa hơn.

**2c. Sửa timezone** ở `getMyRequests` (~dòng 152–156) và `getAll` (~dòng 207–211):
```js
if (from) filter.createdAt.$gte = moment.tz(from, TZ).startOf("day").toDate();
if (to)   filter.createdAt.$lte = moment.tz(to, TZ).endOf("day").toDate();
```

`src/routes/request.js` **không đổi**.

### Bước 3 — Tạo seed script

**File mới:** `scripts/seedRbac.js` — theo pattern `scripts/seedKpiMetrics.js` (dotenv, mongoose.connect, log created/skipped, idempotent, chạy lại an toàn):

1. Loop `PERMISSION_VALUES` → `PermissionModel.findOne({ code })`; chưa có thì create với `group = code.split(".")[0]`; nếu có nhưng `isDeleted: true` thì khôi phục.
2. Tạo role `{ code: "hr", name: "Nhân sự" }` nếu chưa có; gán `hrm.request.view_all` qua `RolePermissionModel` (tìm trước khi create, un-soft-delete nếu cần — tránh E11000 do unique index `{role, permission}`).
3. Không cần invalidate Redis cache trong script (TTL 60s, script không gán `UserRole`; việc gán role qua API RBAC admin đã tự invalidate).

Chạy: `node scripts/seedRbac.js`.

### Bước 4 — Merge min/max chấm công

**File:** `src/helpers/attendanceHelper.js`, hàm `resolveAttendanceDay` (dòng 83–86).

Cả `machineIn`/`machineOut` (parse từ `moment.tz(...).toDate()`) lẫn `worksheet.check_in`/`check_out` đều là Date instant → so sánh epoch trực tiếp là đúng timezone. Thay dòng 83–86:
```js
const appIn = worksheet.check_in ? new Date(worksheet.check_in) : null;
const appOut = worksheet.check_out ? new Date(worksheet.check_out) : null;
// Checkin sớm nhất, checkout muộn nhất giữa máy chấm công và app
let newCheckIn  = machineIn && appIn   ? (machineIn <= appIn ? machineIn : appIn)     : machineIn || appIn;
let newCheckOut = machineOut && appOut ? (machineOut >= appOut ? machineOut : appOut) : machineOut || appOut;
```

Giữ nguyên phần sau:
- Override `forgot_checkin` (dòng 87–92) chạy SAU min/max và vẫn thắng — đơn đã duyệt là dữ liệu chuẩn (thêm comment ngắn ghi rõ).
- `MIN_GAP_MINUTES = 120` (dòng 94–98) giữ nguyên, giờ áp lên cặp giờ đã merge.
- Idempotency check (`unchanged`, dòng 174–182) so bằng `getTime()`, hoạt động bình thường.

### Bước 5 — Sửa isDeleted

**File:** `src/controllers/AttendanceController.js`

Thêm `isDeleted: false` vào filter `WorkSheetModel.findOne` trong `checkIn` (~dòng 164–167) và `checkOut` (~dòng 283–286).

### Bước 6 — Test

**File mới:** `__tests__/attendanceMerge.test.js` — test unit `resolveAttendanceDay` (pure function, không cần DB — stub 2 penalty resolver, worksheet là plain object). Cases:

1. Cả machine + app → checkin sớm nhất, checkout muộn nhất (cả 2 chiều).
2. Chỉ 1 nguồn → fallback như cũ.
3. `forgot_checkin` đã duyệt override giá trị merge.
4. Gap sau merge < 120 phút → checkout bị null.
5. `unchanged` vẫn fire khi giá trị merge trùng giá trị đã lưu.

Không viết integration test cho `getAll` (cần wire express + redis mock, không cân xứng — `__tests__/rbac.integration.test.js` đã cover semantics `can()`). Test chỉ chạy local, không wire CI.

## 3. Verification

1. `npm test` — suite cũ pass + `attendanceMerge.test.js` mới.
2. `node scripts/seedRbac.js` chạy 2 lần trên dev DB — lần 2 toàn skip, không lỗi E11000.
3. Manual trên dev server:
   - Token admin: `GET /request` thấy đơn của mọi reviewer; `PATCH /request/review/:id` với đơn không gán cho mình → OK; đơn của chính mình → 403.
   - Account HR (role `user`) + gán role `hr` qua `POST /rbac/users/:accountId/roles` → `GET /request` thấy tất cả; review → 403.
   - Manager thường: `GET /request` vẫn chỉ thấy đơn gán cho mình.
   - App checkin 08:05 rồi import excel in 07:58 / out 17:35 → worksheet 07:58–17:35; ngược lại (excel in 08:10 vs app 08:05) → giữ 08:05.

## 4. Rủi ro / lưu ý

- Admin **không có UserInfo** vẫn 404 ở `review` (cần `reviewerInfo._id` cho `reviewed_by`) — ràng buộc có sẵn, chấp nhận.
- Re-import excel tháng cũ sau khi đổi merge sẽ **tính lại** những ngày app sớm/muộn hơn máy → số công/phạt có thể thay đổi. Cẩn thận khi re-import dữ liệu cũ.
- Bug phụ ngoài scope (đã phát hiện, KHÔNG sửa đợt này):
  - `leave_balance` có thể âm: validate theo `projectedBalance` (cộng dồn tương lai) nhưng `onCreate` trừ balance hiện tại.
  - Refund lệch khi đơn nửa paid/nửa unpaid (`resolveLeaveConflictOnAttendance` refund cố định 1/0.5 mỗi period).
  - `importExcel` transaction theo từng ngày — fail giữa file thì các ngày trước đã commit.
  - App checkin/checkout không tính `work_unit`/`penalty_amount` (chỉ excel import tính) → ngày chỉ chấm qua app thiếu số công cho tới khi import.

## 5. Tiến độ

- [x] Bước 1 — Permission constant `hrm.request.view_all` + `hrm.request.review_all`
- [x] Bước 2 — Refactor RequestController (getAll inline `can()` + review theo quan hệ/permission + timezone)
- [x] Bước 3 — `scripts/seedRbac.js`
- [x] Bước 4 — Merge min/max `attendanceHelper.js` (dùng `Math.min`/`Math.max`, tránh nested ternary)
- [x] Bước 5 — isDeleted `AttendanceController.js`
- [x] Bước 6 — `__tests__/attendanceMerge.test.js` (7 case, pass)
- [x] `npm test` — 53/53 pass (đã bổ sung jest/supertest/mongodb-memory-server vào devDependencies — trước đó thiếu; sửa test cũ hardcode count = 8 → `PERMISSION_VALUES.length`; thêm env jest vào `.eslintrc.json` cho `__tests__/`)
- [x] Fix bug nghỉ phép hồi tố đè ngày đã đi làm: `onApprove` gọi `resolveLeaveConflictOnAttendance` cho ngày đã có đủ check-in + check-out (`leaveHandler.js`) + test `__tests__/leaveRetroactive.test.js` (3 case)
- [x] Fix bug tiềm ẩn `WorkDayStatusModel`: spread `...BaseSchema.options` kéo theo `_id: false` → document hydrate không có `_id` → `findByIdAndUpdate` trong resolver **âm thầm no-op** — kịch bản "nghỉ phép nhưng thực tế đi làm" chưa từng chạy đúng trên production
- [ ] `node scripts/seedRbac.js` chạy 2 lần trên dev DB
- [ ] Manual API: admin view/review, HR view-only, manager scoped, merge chấm công 2 chiều
- [ ] Rà soát data cũ: các ngày nhân viên đi làm trong kỳ nghỉ đã duyệt trước đây chưa từng được lật present / hoàn phép (do bug `_id`) — cân nhắc re-import excel hoặc script đối soát
