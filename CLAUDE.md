# vWork API — CLAUDE.md

## Tổng quan dự án

Backend REST API cho hệ thống quản lý nội bộ doanh nghiệp (vWork). Xây dựng bằng Node.js + Express + MongoDB.

**Môi trường:**
- Dev: macOS (local)
- Production: Ubuntu Server, reverse proxy qua Traefik
- Database: MongoDB với Replica Set (replicaSet=rs0)
- Cache: Redis

---

## Khởi chạy

```bash
npm start   # node index.js (production / Dokploy)
npm run dev # nodemon index.js (local dev)
```

Biến môi trường được load từ `.env` bằng `dotenv`. File `.env` có sẵn trong project — không commit lên git.

---

## Cấu trúc thư mục

```
index.js                        # Entry point: kết nối DB, khởi cron jobs, lắng nghe port
src/
  config/
    connectDB.js                # Kết nối MongoDB
    firebase.js                 # Firebase Admin SDK (push notification)
    redis.js                    # Redis client
    common/utils.js
  controllers/                  # Xử lý logic request/response
  middlewares/
    authMiddleware.js           # authenticate + isAdmin + isManager + hasCrmAccess
    uploadFile.js               # Multer upload chung
    uploadDocuments.js          # Multer động theo DocumentType
    uploadInternal.js           # Multer cho ổ file nội bộ (lưu theo dept_code)
    uploadWeeklyReport.js       # Multer cho báo cáo tuần (subfolder: weekly-reports)
    verifyInternalRequest.js    # Xác thực API key + IP cho các app nội bộ
    loggingMiddleware.js
  models/                       # Mongoose schemas
  routes/
    index.js                    # Đăng ký tất cả router vào app
  jobs/                         # Cron jobs và startup tasks
  helpers/
    pushNotification.js         # Firebase FCM wrapper
    commissionCalculator.js
uploads/                        # Thư mục upload (dev), gitignored
```

---

## Biến môi trường quan trọng

| Biến | Mô tả |
|---|---|
| `PORT` | Port server (default 2345) |
| `MONGODB_URI` | MongoDB connection string |
| `NODE_ENV` | `dev` hoặc `production` |
| `SECRET_KEY` | JWT access token secret |
| `REFRESH_SECRET_KEY` | JWT refresh token secret |
| `UPLOAD_DIR_DEV` / `UPLOAD_DIR_PROD` | Thư mục upload file user (hồ sơ, hợp đồng...) |
| `INTERNAL_DIR_DEV` / `INTERNAL_DIR_PROD` | Thư mục ổ file nội bộ theo phòng ban |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis config |
| `TIKLUY_API_KEY`, `TIKLUY_ALLOWED_IPS` | Xác thực app nội bộ Tikluy |

Mọi path resolve dùng `path.resolve(dir)` — tương thích cả relative (dev) và absolute (prod).

**Dokploy (production):** Mỗi service (test/live) inject env riêng. Cần mount volume cho upload dirs:
- `/var/www/vWork/live/private` và `/var/www/vWork/live/internal` (service live)
- `/var/www/vWork/test/private` và `/var/www/vWork/test/internal` (service test)

---

## Authentication & Authorization

**JWT Bearer token** — mọi route protected đều qua `authenticate` middleware.

```js
req.account = {
  _id, username, role,
  crm_access,   // boolean
  dept_scope,   // "all" | "own"
}
```

### Hệ thống phân quyền

**AccountModel có 3 field quyền:**

| Field | Giá trị | Mô tả |
|---|---|---|
| `role` | `"admin"` | Toàn quyền, bypass mọi kiểm tra |
| `role` | `"manager"` | Quyền quản lý trong các module được gán |
| `role` | `"user"` | Nhân viên thường |
| `module_access` | `["hrm","workplace","crm"]` | Module nào được truy cập/quản lý |
| `dept_scope` | `"own"` | Chỉ thao tác phòng ban của mình |
| `dept_scope` | `"all"` | Thao tác tất cả phòng ban |

**Nguyên tắc:**
- `role` là global — không phân biệt manager phòng này vs phòng kia
- `module_access` quyết định module nào có elevated access
- `dept_scope` quyết định phạm vi dữ liệu (phòng mình vs tất cả)
- Không phụ thuộc tên chức danh — gán thủ công trên account
- Khi điều chuyển phòng ban: chỉ cập nhật `UserDepartmentPositionModel`, không cần đổi quyền
- `dept_scope: "own"` tự resolve phòng ban hiện tại từ `UserDepartmentPositionModel` lúc runtime
- 1 người thuộc nhiều phòng ban → `dept_scope: "own"` bao gồm tất cả phòng họ thuộc

**Ví dụ thực tế:**

| Người | role | module_access | dept_scope |
|---|---|---|---|
| IT head | `manager` | `["hrm","workplace"]` | `own` |
| HR nhân viên | `user` | `["hrm"]` | `all` |
| HR manager | `manager` | `["hrm"]` | `all` |
| Sale CRM | `user` | `["crm"]` | `own` |
| Sale CRM manager | `manager` | `["crm"]` | `all` |
| Admin hệ thống | `admin` | — | — |

**Logic hiển thị tab (frontend):**
```js
const has = (mod) => user.role === "admin" || user.module_access.includes(mod)

showHRM       = true       // tất cả đều thấy
showWorkplace = true       // tất cả đều thấy
showCRM       = has("crm") // chỉ khi có crm trong module_access
```

**Logic hiển thị tính năng (frontend):**
```js
const has     = (mod) => user.role === "admin" || user.module_access.includes(mod)
const canMgr  = (mod) => user.role === "admin" || (user.role === "manager" && user.module_access.includes(mod))

// HRM
showEmployeeList   = has("hrm")      // xem ds nhân viên — user + manager có hrm
showAddEmployee    = canMgr("hrm")   // thêm/sửa — chỉ manager hrm
showDepartmentList = has("hrm")      // xem ds phòng ban
showMyProfile      = true            // hồ sơ cá nhân — tất cả

// Workplace
showWeeklyReportAll  = canMgr("workplace")  // xem báo cáo tất cả phòng ban
showWeeklyReportMine = true                 // nộp/xem báo cáo phòng mình — tất cả

// CRM
showMyCustomers = has("crm")               // khách hàng của mình
showCustomerAll = canMgr("crm")            // tất cả khách hàng
```

**Middleware dùng trong routes:**
```js
authenticate               // verify JWT, gắn req.account
isAdmin                    // chỉ cho role = "admin"
hasModuleAccess("hrm")     // xem — user hoặc manager có module trong module_access
canManage("hrm")           // quản lý — phải là manager + có module trong module_access
verifyInternalRequest      // xác thực app nội bộ qua API key + IP whitelist
```

**`req.account` sau authenticate:**
```js
{
  _id, username,
  role,           // "admin" | "manager" | "user"
  module_access,  // ["hrm", "workplace", "crm"]
  dept_scope,     // "all" | "own"
}
```

**API gán quyền (admin only):**
```
PATCH /auth/set-permission/:accountId
Body: { role, module_access, dept_scope }  // tất cả optional
```

---

## Quan hệ Model chính

```
account (AccountModel)
  ├── role: "admin" | "manager" | "user"
  ├── crm_access: boolean
  ├── dept_scope: "all" | "own"
  └── user_info (UserInfoModel)         [id_account → account]
        └── user_department_position   [user → user_info, department, position]

department (DepartmentModel)
  └── dept_folder_permission            [department → dept, grantedUsers[], grantedDepts[]]

internal_file (InternalFileModel)
  ├── department → department
  ├── uploadedBy → account
  ├── subfolder  (string, e.g. "weekly-reports")
  └── category   ("general" | "weekly_report")

weekly_report (WeeklyReportModel)
  ├── department → department
  ├── weekStart  (Monday 00:00)
  ├── deadline   (Friday 17:00)
  ├── file → internal_file
  ├── submittedBy → account
  ├── submittedAt, note
  └── status: "pending" | "submitted" | "late" | "missing" | "not_started"
```

**Lưu ý:** `UserDepartmentPositionModel` dùng `user → user_info._id`, không phải `account._id`. Khi cần tìm dept của 1 account:
```js
const userInfo = await UserInfoModel.findOne({ id_account: accountId });
const memberships = await UserDepartmentPositionModel.find({ user: userInfo._id });
```

---

## File Storage

### Upload thông thường (hồ sơ nhân viên, hợp đồng)
- Multer: `uploadFile.js` → lưu vào `UPLOAD_DIR_{ENV}`
- Serve qua: `GET /document/getFile?filename=...`

### Ổ file nội bộ (Internal Drive)
- Cấu trúc disk: `INTERNAL_DIR/{dept_code}/{filename}`
- Subfolder hỗ trợ: `INTERNAL_DIR/{dept_code}/{subfolder}/{filename}`
- Multer: `uploadInternal.js` — tự resolve dept_code từ `req.params.deptId`
- Khi tạo phòng ban → `ensureFolderForDept(dept_code)` tạo folder ngay
- Khi server khởi động → `ensureAllDeptFolders()` sync folder cho tất cả dept đã có

**Phân quyền Internal Drive:**
- Thành viên phòng ban: xem + upload folder của phòng ban mình
- Được cấp quyền (qua `DeptFolderPermission`): chỉ xem
- Admin: full access tất cả

---

## Cron Jobs

| File | Lịch | Mô tả |
|---|---|---|
| `genWorkSheet.js` | `1 0 * * *` (00:01 hàng ngày) | Tạo WorkSheet cho tất cả nhân viên |
| `cleanupDeviceTokens.js` | — | Dọn FCM token cũ/inactive |
| `ensureDeptFolders.js` | Startup (1 lần) | Tạo folder disk cho dept chưa có |
| `weeklyReportJob.js` | Thứ 6 8:00 + 17:00 | Nhắc nộp + đánh dấu missing báo cáo tuần |

Tất cả cron dùng `node-cron`. Múi giờ server: `Asia/Ho_Chi_Minh` (set ở đầu `index.js`).

---

## Push Notification

Dùng Firebase Admin SDK FCM.

```js
// Helper: src/helpers/pushNotification.js
pushNotification.sendToAccount({ account_id, title, body, data })
```

- Tự lấy tất cả FCM token active của account đó
- Gửi multicast qua `sendEachForMulticast`
- Tự deactivate token invalid sau khi gửi

---

## Conventions

**Response format:**
```js
// Success
res.status(200).json({ message: "...", data: ... })

// Error
res.status(4xx/5xx).json({ message: "...", error: error.message })
```

**Soft delete:** Tất cả model đều có `isDeleted: boolean` từ `BaseSchema`. Không xóa thật trong DB — luôn dùng `{ isDeleted: false }` khi query.

**BaseSchema:** Mọi model kế thừa `...BaseSchema.obj` và dùng `timestamps`, `toJSON`, `toObject` từ BaseSchema. `toJSON`/`toObject` tự format `createdAt`/`updatedAt` sang `Asia/Ho_Chi_Minh`.

**Tên collection:** snake_case (`user_info`, `user_department_position`, `internal_file`...)

**File upload multer:** Tên file lưu disk = `{timestamp}-{random}{ext}`. Tên gốc lưu trong DB field `originalName`.

**MongoDB Transaction:** Bất kỳ API nào ghi vào **nhiều hơn 1 collection** trong cùng 1 request phải dùng transaction. MongoDB đã chạy Replica Set (`replicaSet=rs0`) nên transaction hoạt động sẵn.

```js
const session = await mongoose.startSession();
session.startTransaction();
try {
    await ModelA.create([{ ... }], { session });
    await ModelB.findByIdAndUpdate(id, { ... }, { session });
    await session.commitTransaction();
} catch (err) {
    await session.abortTransaction();
    throw err;
} finally {
    session.endSession();
}
```

Các trường hợp **bắt buộc** dùng transaction:
- Submit báo cáo tuần: tạo `InternalFile` + cập nhật `WeeklyReport`
- Re-submit báo cáo: soft-delete `InternalFile` cũ + tạo mới + cập nhật `WeeklyReport`
- Bất kỳ thao tác nào mà thất bại giữa chừng sẽ để lại dữ liệu không nhất quán

---

## API Routes

| Prefix | File | Middleware mặc định | Mô tả |
|---|---|---|---|
| `/auth` | auth.js | — | Đăng nhập, refresh token, gán quyền |
| `/user` | user.js | `isManager` | Quản lý nhân viên |
| `/department` | department.js | `isManager` | Phòng ban + vị trí |
| `/attendance` | attendance.js | `authenticate` | Chấm công |
| `/document` | document.js | `authenticate` | Loại tài liệu, xem file hồ sơ |
| `/laborContract` | laborContract.js | `isManager` | Hợp đồng lao động |
| `/customer` | customer.js | `hasCrmAccess` | Khách hàng |
| `/referral` | referral.js | — | Giới thiệu (internal) |
| `/investments` | investment.js | `hasCrmAccess` | Đầu tư |
| `/claim-period` | claimPeriod.js | `hasCrmAccess` | Kỳ claim hoa hồng |
| `/agents` | agent.js | `hasCrmAccess` | Đại lý |
| `/app` | app.js | — | App config |
| `/notification` | notification.js | `authenticate` | FCM device token |
| `/internal-files` | internalFile.js | `authenticate` | Ổ file nội bộ theo phòng ban |
| `/weekly-reports` | weeklyReport.js | `authenticate` | Báo cáo tuần |

---

## Báo cáo tuần (Weekly Report)

Mỗi phòng ban nộp báo cáo hàng tuần, deadline **17:00 thứ 6**.

- File báo cáo là `InternalFile` (category: `weekly_report`, subfolder: `weekly-reports`)
- `WeeklyReport` là record tracking trỏ vào `InternalFile`
- Cron thứ 6 8:00: tạo record pending + push notification nhắc nộp
- Cron thứ 6 17:00: đánh dấu `missing` các dept chưa nộp
- Re-submit: soft-delete file cũ + upload file mới, giữ nguyên status
- `GET /weekly-reports/admin` trả đủ tất cả phòng ban kể cả chưa có record

**Status flow:**

| Status | Ý nghĩa |
|---|---|
| `not_started` | Đầu tuần, chưa có record (trước thứ 6 8:00) |
| `pending` | Cron đã chạy, chưa nộp |
| `submitted` | Đã nộp đúng hạn |
| `late` | Nộp muộn (sau 17:00 thứ 6) |
| `missing` | Quá deadline, không nộp |
