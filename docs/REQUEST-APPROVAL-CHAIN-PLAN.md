# Plan: Tự động xác định người duyệt đơn theo cây phân cấp phòng ban (Approval Chain)

## 1. Bối cảnh

Hiện tại khi tạo đơn (`RequestController.create`, src/controllers/RequestController.js:50-141), client phải tự truyền `assigned_reviewer` (ObjectId của `UserInfo`), được validate khớp với danh sách trả về từ `getEligibleReviewers()` (src/helpers/requestUtils.js:90-127) — hàm này chỉ lọc theo `account.role === "manager"` + cùng `branch_id` (hoặc `dept_scope: "all"`), **không hề dùng cây phân cấp phòng ban** (`DepartmentModel.parent`) dù dữ liệu đã có sẵn.

Vấn đề với thiết kế hiện tại:
- Client phải biết trước "ai là quản lý của mình" để truyền lên — trải nghiệm kém, dễ chọn sai.
- `getAll` (dòng 188-256) và `review` (dòng 258-358) đều dựa vào giá trị `assigned_reviewer` **đã đóng băng tại thời điểm tạo đơn** — nếu tổ chức đổi người quản lý sau đó, đơn cũ vẫn "dính" vào người quản lý cũ đã có thể không còn phù hợp.
- Việc phân biệt "ai được quyền duyệt" đang dựa vào `account.role === "manager"` (field toàn cục, không gắn với phòng ban cụ thể) — không tận dụng hệ RBAC permission-based đã áp dụng cho `hrm.request.view_all`/`review_all`.

**Mục tiêu (theo yêu cầu):**
1. Tạo đơn **không cần truyền người duyệt** — đơn luôn tạo thành công bình thường, không có bước nào chặn tạo đơn vì lý do "chưa tìm được người duyệt".
2. "Ai được duyệt đơn của ai" được tính **động** (live) mỗi lần cần — bằng cách đi từ phòng ban của người tạo đơn lên cao dần trong cây (`DepartmentModel.parent`), tìm người **có permission duyệt đơn** (RBAC — không dùng `account.role` nữa), đồng thời phải cùng chi nhánh.
3. Khi tạo đơn thành công: chỉ báo cho **quản lý trực tiếp** (người gần nhất tìm được trong chuỗi) — best-effort, không tìm thấy thì bỏ qua, không lỗi.
4. Khi duyệt đơn xong: báo cho **nhân sự (HR)** + **quản lý trực tiếp** + **chính người tạo đơn**.
5. `getAll`: người có quyền duyệt (bất kỳ cấp nào trong chuỗi, không chỉ người gần nhất) thấy được đơn của nhân viên thuộc phạm vi quản lý của mình. HR xem tất cả (không đổi, `view_all`). Admin xem tất cả + duyệt được tất cả (không đổi, bypass có sẵn).

---

## 2. Quyết định thiết kế

### 2.1. Xác định người duyệt bằng permission thuần túy — không có khái niệm "trưởng phòng"

Không thêm flag `is_head` vào `PositionModel`/`UserDepartmentPositionModel`, không thêm bảng scope riêng. Chốt: **là thành viên của phòng ban (hoặc tổ tiên của nó) trong chuỗi + có permission `hrm.request.review` + cùng chi nhánh** là đủ để được coi là người duyệt hợp lệ — không cần phân biệt "có phải trưởng phòng thật sự hay không".

- Thêm permission mới `HRM_REQUEST_REVIEW = "hrm.request.review"` (khác `HRM_REQUEST_REVIEW_ALL` — cái này là admin/HR override duyệt **mọi** đơn; permission mới chỉ cho duyệt đơn của người **trong phạm vi quản lý** của mình).
- 1 người được coi là "người duyệt hợp lệ cho nhân viên E" nếu: **thuộc cùng phòng ban hoặc phòng ban tổ tiên** của E (qua `UserDepartmentPositionModel` + `DepartmentModel.parent`), **VÀ** account của họ có permission `hrm.request.review` (qua `can()` trong `src/helpers/rbac.js` — permission toàn cục trên account), **VÀ** cùng `branch_id` với E (xem 2.2).
- Gán quyền: đặt người vào phòng ban qua `UserDepartmentPositionModel` (có sẵn) + gán role mang permission `hrm.request.review` qua API RBAC admin có sẵn (`POST /rbac/users/:accountId/roles`) — không cần thêm cơ chế mới, dùng nguyên `RbacController.js` hiện có.

**Trade-off đã cân nhắc và chấp nhận (không phải lỗ hổng bỏ sót):** vì `hrm.request.review` là permission **toàn cục trên account** (đúng bản chất hệ RBAC hiện tại — `UserRoleModel`/`UserPermissionModel` không có field scope theo phòng ban, dùng chung cho cả module KPI), nên nếu 1 người vừa có permission này (vì là trưởng phòng A) vừa là thành viên thường (không phải trưởng) của phòng ban B khác (multi-department membership), họ sẽ **nghiễm nhiên cũng được coi là người duyệt hợp lệ ở phòng B** — dù không có thẩm quyền thật ở đó. Chấp nhận rủi ro này để giữ thiết kế đơn giản, không mở rộng RBAC core (vốn cố tình phi-scope, dùng chung nhiều module) chỉ vì 1 tính năng. Nếu sau này phát sinh vấn đề thực tế, sẽ tách permission scoped riêng lúc đó.

### 2.2. Ràng buộc "cùng chi nhánh" — so `branch_id` khớp tuyệt đối ở MỌI cấp, không ngoại lệ

`UserInfoModel.branch_id` (ref `BranchModel`, flat — **không liên quan** đến `DepartmentModel.type: "branch"`, node đó chỉ trùng tên vì nhiều chi nhánh có thể có phòng ban tên giống nhau, không có field liên kết 2 bảng). Ở project hiện tại: mọi người luôn có `branch_id`, không có `null`, và **1 người chỉ phụ trách đúng 1 chi nhánh** — không có nhu cầu 1 người vừa duyệt vừa quản lý nhiều chi nhánh cùng lúc qua cơ chế này. Nên chốt đơn giản nhất: **so `branch_id` bằng nhau ở mọi cấp trong chuỗi, không cần suy luận/ngoại lệ gì cả** (đã cân nhắc và loại bỏ 2 hướng phức tạp hơn: dùng `AccountModel.dept_scope`, và dùng `DepartmentModel.type` leaf/non-leaf — cả 2 đều không cần thiết vì bài toán thực tế không tồn tại).

Nếu sau này phát sinh nhu cầu 1 người phụ trách nhiều chi nhánh, đã có sẵn 2 lối thoát không cần sửa logic này:
1. **`hrm.request.review_all`** (đã có sẵn, admin/HR bypass) — dành cho ai cần duyệt/xem *toàn bộ* đơn không phân biệt chi nhánh/phòng ban.
2. **Gán nhiều dòng `UserDepartmentPositionModel`** — nếu chỉ phụ trách vài chi nhánh cụ thể, gán tường minh nhiều dòng, mỗi dòng vẫn bị check `branch_id` bình thường như mọi người.

### 2.3. Đi lên cây: bắt đầu từ CHÍNH phòng ban của người tạo đơn (level 0), không chỉ từ cấp cha

Người duyệt có thể là đồng cấp (member khác) trong CHÍNH phòng ban leaf của người tạo đơn (department/branch) — đây là trường hợp phổ biến nhất (trưởng phòng cũng là 1 thành viên của chính phòng đó qua `UserDepartmentPositionModel`). Nếu phòng ban đó không có ai đủ điều kiện, đi lên `parent` (division → board → holding), dừng khi tìm thấy hoặc hết cây.

**1 nhân viên thuộc nhiều phòng ban cùng lúc** (schema cho phép): gộp tất cả phòng ban họ thuộc làm điểm xuất phát, đi lên song song, dedupe theo user.

**Không tìm thấy ai trong toàn bộ cây:** đơn vẫn tạo bình thường (không chặn); không gửi thông báo tạo đơn (bỏ qua, không lỗi); `getAll`/`review` sẽ không ai (ngoài admin) thấy/duyệt được đơn đó cho tới khi có người được gán quyền.

### 2.4. `assigned_reviewer` — XÓA HẲN khỏi `RequestModel`, không giữ lại dưới bất kỳ hình thức nào

Ban đầu định giữ lại field này ở dạng "chỉ để hiển thị, không dùng phân quyền", nhưng quyết định cuối: **xóa hẳn khỏi schema**. Lý do: giữ 1 field tên `assigned_reviewer` không còn ý nghĩa phân quyền là mồi ngon cho bug tương lai — ai đó (kể cả chính mình sau này) rất dễ vô tình dùng lại nó để check quyền vì cái tên quá gợi ý, trong khi dữ liệu đã lệch so với thực tế do authorization giờ tính động. Bỏ hẳn field + index `{assigned_reviewer:1, status:1}` liên quan.

- `getMyRequests`/`getAll`: bỏ `.populate("assigned_reviewer", ...)`.
- Muốn hiển thị "đơn đang chờ ai duyệt" ở FE thì gọi `getApprovalChain(userId)[0]` tính lại tại thời điểm đọc — không lưu trữ.
- `getAll`/`review`: authorization tính **động** hoàn toàn bằng cây phân cấp hiện tại (phản ánh đúng tổ chức tại thời điểm gọi API, không bị đóng băng theo lúc tạo đơn).

### 2.5. Role mới: `unit_head`

Chỉ cần **1 role mới** (không cần nhiều role theo khối/chi nhánh — xem lý do dưới), cộng với role `hr` đã có sẵn:

| Role | Permission | Trạng thái |
|---|---|---|
| `hr` (đã có) | `hrm.request.view_all` | Không đổi — xem tất cả, không duyệt |
| **`unit_head`** (mới) | `hrm.request.review` | Cần tạo trong `scripts/seedRbac.js` |
| *(không tạo role riêng)* | `hrm.request.review_all` | Đã có sẵn trong catalogue, cố tình chưa gán cho role nào — admin tự gán tay qua API khi cần, ngoài scope plan này |

**Vì sao chỉ 1 role, không tạo nhiều role theo chức vụ/khối phòng ban:** `UserRoleModel`/`RolePermissionModel` không có field scope theo phòng ban — N role khác nhau (vd "Trưởng khối Kinh doanh", "Trưởng khối Vận hành") sẽ chỉ khác tên hiển thị, đều gắn đúng permission `hrm.request.review` giống hệt nhau, không có tác dụng phân biệt chức năng gì (phạm vi phòng ban/chi nhánh thực tế 100% do `UserDepartmentPositionModel` quyết định — xem 2.1). Thêm nữa, `PositionModel.position_name` là free-text do admin gõ tay (`DepartmentPositionController.js:156-162`, không có enum/chuẩn hóa) — không đủ tin cậy để tự động suy ra role theo tên chức vụ.

**Vì sao không đặt tên role gắn với "duyệt đơn" (vd `request_approver`):** role này về sau có thể được gán thêm permission khác ngoài request (KPI, workplace...) — không nên đặt tên hẹp theo 1 permission cụ thể. `unit_head` ("trưởng đơn vị") là tên chức danh chung, không ràng buộc vào tính năng nào, phù hợp để cơi nới permission dần theo thời gian. Cũng tránh trùng với `AccountModel.role` (giá trị `"manager"` đã tồn tại sẵn ở field toàn cục cũ) để không gây nhầm lẫn 2 khái niệm khi đọc log/data.

**Không cần API mới để tạo role/permission:** đã xác nhận `RbacController.js` chỉ có `listRoles`/`listPermissions`/`assignRole`/`revokeRole`/`setUserPermission`/`removeUserPermission` — tạo mới role/permission (catalogue) chỉ làm qua seed script, đúng pattern đã dùng cho role `hr` trước đây. Việc gán role `unit_head` cho từng account cụ thể dùng nguyên API `assignRole` có sẵn.

### 2.6. Rollout: script liệt kê ứng viên để admin duyệt tay, không tự động gán

Ngay sau deploy, chưa account nào có permission `hrm.request.review` — nếu không làm gì thêm, `getAll`/`review` sẽ không trả về gì cho ai (trừ admin) cho tới khi admin gán role `unit_head` cho từng người thực tế là quản lý đơn vị. Vì `position_name` là free-text không đáng tin để tự động 100% (xem 2.5), **không viết script tự động gán** — thay vào đó viết script chỉ **liệt kê ứng viên khả nghi** ra console (join `UserDepartmentPositionModel` với `position_name` chứa từ khóa như "trưởng"/"giám đốc"/"quản lý", không phân biệt hoa thường) để admin xem, tự xác nhận, rồi gọi API `assignRole` có sẵn cho đúng người. Script này không ghi gì vào DB — chỉ hỗ trợ tra cứu.

### 2.7. Endpoint `GET /request/eligible-reviewers` — đổi mục đích

Không còn dùng để chọn người duyệt lúc tạo đơn (vì không cần input nữa). Đổi thành **preview**: trả về người gần nhất trong chuỗi (giống cái sẽ được thông báo lúc tạo đơn thành công, tính qua `getApprovalChain(userInfoId)[0]`) — để frontend có thể hiển thị "đơn của bạn sẽ được chuyển tới X" trước khi bấm gửi, không bắt buộc phải dùng.

---

## 3. Các bước thực hiện

| Bước | Nội dung | File chính |
|---|---|---|
| 1 | Tạo `docs/REQUEST-APPROVAL-CHAIN-PLAN.md` (copy nội dung plan này vào repo, theo đúng pattern `docs/REQUEST-RBAC-PLAN.md`) | `docs/REQUEST-APPROVAL-CHAIN-PLAN.md` |
| 2 | Thêm permission `HRM_REQUEST_REVIEW` | `src/constants/permissions.js` |
| 3 | Viết helper cây phân cấp: `getApprovalChain(userInfoId)` (đi lên, trả về mảng có thứ tự gần→xa) + `getManagedUserIds(managerUserInfo)` (đi xuống, dùng cho `getAll`) | `src/helpers/approvalChain.js` (mới) |
| 4 | Thêm `getAccountsWithPermission(permissionCode)` vào rbac helper (dùng để tìm toàn bộ tài khoản HR cần báo khi duyệt đơn xong) | `src/helpers/rbac.js` |
| 5 | Test riêng cho helper cây phân cấp (case ở mục 5) trước khi đụng vào `RequestController.js` | `__tests__/approvalChain.test.js` (mới) |
| 6 | Xóa hẳn field `assigned_reviewer` + index liên quan khỏi `RequestModel` | `src/models/RequestModel.js` |
| 7 | Migrate `RequestController.create`: bỏ input/validate `assigned_reviewer`, bỏ chặn "chưa gán chi nhánh", gọi `getApprovalChain(userInfo._id, { stopAtFirstMatch: true })` best-effort chỉ để gửi thông báo (không lưu gì vào request) | `src/controllers/RequestController.js` |
| 8 | Migrate `getAll`: gate theo permission `HRM_REQUEST_REVIEW` (thay vì `role==="user"`/`"manager"`), filter theo `getManagedUserIds` (thay vì `assigned_reviewer` tĩnh) | `src/controllers/RequestController.js` |
| 9 | Migrate `review`: authorization theo `getApprovalChain(request.user_id)` (mặc định đầy đủ chuỗi) chứa `req.account` (thay vì so `assigned_reviewer`); mở rộng thông báo duyệt/từ chối cho người tạo đơn + quản lý trực tiếp (`getApprovalChain(..., {stopAtFirstMatch:true})[0]`) + toàn bộ HR (`getAccountsWithPermission`) — **gộp danh sách người nhận theo `accountId` (dedupe) rồi loại bỏ chính `req.account._id` (người vừa duyệt) khỏi TOÀN BỘ danh sách trước khi gửi**, không chỉ loại khỏi phần "quản lý trực tiếp" | `src/controllers/RequestController.js` |
| 10 | Đổi mục đích `getEligibleReviewers` endpoint → preview người gần nhất; xóa hàm cũ `getEligibleReviewers` khỏi `requestUtils.js` | `src/controllers/RequestController.js`, `src/helpers/requestUtils.js` |
| 11 | Thêm role `unit_head` (permission `hrm.request.review`) vào `scripts/seedRbac.js` | `scripts/seedRbac.js` |
| 12 | Viết script liệt kê ứng viên rollout (theo 2.6) — chỉ in ra console, không ghi DB | `scripts/listApprovalCandidates.js` (mới) |
| 13 | Cập nhật `__tests__/requestControllerCreate.test.js` (không còn cần `assigned_reviewer` trong body) + viết test mới cho `getAll`/`review` với authorization động | `__tests__/requestControllerCreate.test.js`, `__tests__/requestApprovalFlow.test.js` (mới) |
| 14 | Chạy `npm test` toàn bộ + verify thủ công (mục 6) | — |

---

## 4. Thiết kế chi tiết helper (`src/helpers/approvalChain.js`)

**Lưu ý chung cho cả 2 hàm dưới đây:** không nhận tham số `session` — đây là đọc dữ liệu tổ chức "hiện hành" (ai đang thuộc phòng ban nào, ai đang có quyền gì), không cần nhất quán theo snapshot của 1 transaction cụ thể nào. Dùng độc lập với transaction của `create()`/`review()`.

```js
// Đi lên: trả về mảng người duyệt hợp lệ, gần nhất trước (level 0 = chính phòng ban của employee).
// stopAtFirstMatch=true: dừng ngay khi tìm được match ở 1 cấp, không đi tiếp lên cao hơn
// — dùng cho create() (chỉ cần người gần nhất để báo, không cần cả chuỗi).
// getAll()/review() gọi mặc định (false) vì cần TOÀN BỘ chuỗi.
async function getApprovalChain(userInfoId, { stopAtFirstMatch = false } = {}) {
  const employee = await UserInfoModel.findById(userInfoId, { branch_id: 1, isDeleted: 1 });
  if (!employee || employee.isDeleted) return [];

  const memberships = await UserDepartmentPositionModel.find({
    user: userInfoId, isDeleted: false
  }).distinct("department");
  if (!memberships.length) return [];

  const seenDeptIds = new Set();
  const chain = [];
  const seenUsers = new Set();
  let frontier = memberships.map(String);

  while (frontier.length && seenDeptIds.size < 50 /* safety cap chống loop hỏng data */) {
    const newFrontier = frontier.filter((id) => !seenDeptIds.has(id));
    if (!newFrontier.length) break;
    newFrontier.forEach((id) => seenDeptIds.add(id));

    // Tìm candidate ở đúng cấp hiện tại (loại trừ chính employee)
    const candidateUserIds = await UserDepartmentPositionModel.find({
      department: { $in: newFrontier }, isDeleted: false, user: { $ne: userInfoId }
    }).distinct("user");

    if (candidateUserIds.length) {
      const candidates = await UserInfoModel.find({
        _id: { $in: candidateUserIds }, isDeleted: false
      }, { branch_id: 1, full_name: 1, id_account: 1 });

      // Lọc branch_id trước (rẻ, không cần I/O) để giảm số candidate phải check permission
      const branchMatched = candidates.filter(
        (c) => employee.branch_id && c.branch_id && employee.branch_id.equals(c.branch_id)
      );

      const accounts = await AccountModel.find({
        _id: { $in: branchMatched.map((c) => c.id_account) }, isDeleted: false
      }, { role: 1 });
      const accountMap = new Map(accounts.map((a) => [String(a._id), a]));

      // Check permission song song thay vì tuần tự trong for — tránh N+1 round-trip Redis/DB
      const permissionChecks = await Promise.all(
        branchMatched.map((c) => {
          const account = accountMap.get(String(c.id_account));
          return account ? can(account, PERMISSION.HRM_REQUEST_REVIEW) : Promise.resolve(false);
        })
      );

      branchMatched.forEach((c, i) => {
        if (!permissionChecks[i] || seenUsers.has(String(c._id))) return;
        seenUsers.add(String(c._id));
        chain.push({ userInfoId: c._id, accountId: c.id_account, full_name: c.full_name });
      });
    }

    if (stopAtFirstMatch && chain.length) break;

    // Lên 1 cấp
    const depts = await DepartmentModel.find({
      _id: { $in: newFrontier }, isDeleted: false
    }, { parent: 1 });
    frontier = depts.map((d) => d.parent).filter(Boolean).map(String);
  }

  return chain; // thứ tự: gần nhất trước
}
```

**`getManagedUserIds(managerUserInfoId)`** — chiều ngược lại (đi xuống `children` thay vì `parent`), dùng cho `getAll`. Khác biệt quan trọng so với `getApprovalChain`: **không check lại permission cho từng nhân viên cấp dưới** — quyền đã được gate 1 lần duy nhất ở `getAll()` cho chính manager gọi API (`can(req.account, PERMISSION.HRM_REQUEST_REVIEW)`), ở đây chỉ cần lọc theo phòng ban con cháu + khớp `branch_id`, không có gì để "authorize" thêm cho phía nhân viên (nhân viên không cần quyền gì cả, họ chỉ là đối tượng bị xem):

```js
async function getManagedUserIds(managerUserInfoId) {
  const manager = await UserInfoModel.findById(managerUserInfoId, { branch_id: 1, isDeleted: 1 });
  if (!manager || manager.isDeleted) return [];

  const ownDepts = await UserDepartmentPositionModel.find({
    user: managerUserInfoId, isDeleted: false
  }).distinct("department");
  if (!ownDepts.length) return [];

  const seenDeptIds = new Set(ownDepts.map(String));
  let frontier = ownDepts.map(String);

  // BFS xuống: gom toàn bộ phòng ban con cháu (bao gồm chính phòng ban của manager)
  while (frontier.length) {
    const children = await DepartmentModel.find({
      parent: { $in: frontier }, isDeleted: false
    }, { _id: 1 });
    const newIds = children.map((d) => String(d._id)).filter((id) => !seenDeptIds.has(id));
    if (!newIds.length) break;
    newIds.forEach((id) => seenDeptIds.add(id));
    frontier = newIds;
  }

  const members = await UserDepartmentPositionModel.find({
    department: { $in: [...seenDeptIds] }, isDeleted: false, user: { $ne: managerUserInfoId }
  }).distinct("user");
  if (!members.length) return [];

  const employees = await UserInfoModel.find({
    _id: { $in: members }, isDeleted: false, branch_id: manager.branch_id
  }, { _id: 1 });

  return employees.map((e) => e._id);
}
```

`getAccountsWithPermission(permissionCode)` (trong `rbac.js`) — reverse-lookup role → permission → user, dùng để tìm toàn bộ tài khoản HR cần báo khi duyệt đơn xong:
```js
async function getAccountsWithPermission(permissionCode) {
  const permission = await PermissionModel.findOne({ code: permissionCode, isDeleted: false });
  if (!permission) return [];
  const roleIds = (await RolePermissionModel.find({
    permission: permission._id, isDeleted: false
  }).distinct("role"));
  if (!roleIds.length) return [];
  return UserRoleModel.find({ role: { $in: roleIds }, isDeleted: false }).distinct("user");
}
```
*Lưu ý phạm vi: hàm này chỉ tính permission gán qua role, KHÔNG tính override cá nhân qua `UserPermissionModel` (ALLOW trực tiếp không qua role) — chấp nhận được vì HR luôn được gán qua role `hr` theo pattern hiện tại, không có tiền lệ gán override cá nhân cho view_all.*

---

## 5. Test (`__tests__/approvalChain.test.js`)

1. Trưởng phòng cùng cấp (level 0, cùng phòng ban leaf) → tìm thấy ngay, không cần đi lên.
2. Phòng ban leaf không có ai đủ quyền → đi lên `parent`, tìm thấy ở division.
3. Không tìm thấy ai trong toàn bộ cây (tới `holding`) → trả về mảng rỗng, không lỗi.
4. Người khác chi nhánh (dù cùng phòng ban tổ tiên) → luôn bị loại, không có ngoại lệ nào.
5. Người cùng chi nhánh nhưng KHÔNG có permission `hrm.request.review` → bị loại.
6. Nhân viên thuộc nhiều phòng ban cùng lúc → gộp điểm xuất phát, không bỏ sót nhánh nào.
7. Admin luôn pass qua `can()` — nếu admin được gán vào 1 phòng ban trong chuỗi, luôn được coi là hợp lệ dù không có permission gán tay.
8. `getManagedUserIds` — kiểm tra chiều ngược lại: manager ở cấp division thấy được nhân viên ở phòng ban con cháu (cùng chi nhánh); nhân viên không có permission `hrm.request.review` vẫn xuất hiện trong danh sách (hàm này không check permission phía nhân viên).
9. `getAccountsWithPermission` — trả đúng danh sách account có permission qua role, dedupe khi 1 account có nhiều role cùng cấp permission.
10. `stopAtFirstMatch: true` — có match ở level 0 → dừng ngay, không query tiếp lên `parent` (assert số lần gọi `DepartmentModel.find` để xác nhận không đi quá 1 vòng); level 0 không có ai, level 1 (division) có → dừng ở đó, không đi tiếp lên `board`/`holding`.
11. Permission check trong `getApprovalChain` chạy qua `Promise.all` — test với nhiều candidate cùng cấp, xác nhận vẫn ra đúng kết quả (không quan tâm thứ tự resolve của promise).

---

## 6. Verification

1. `npm test` — toàn bộ suite pass, gồm `approvalChain.test.js` mới và `requestApprovalFlow.test.js` mới. `requestApprovalFlow.test.js` cần có riêng 1 case: **người duyệt trùng với quản lý trực tiếp/HR** (seed 1 account vừa có role `unit_head` vừa có role `hr`) → duyệt đơn → assert người này chỉ nhận đúng 1 thông báo (không phải 2), và không tự nhận thông báo về hành động của chính mình.
2. Sanity check tương tự bước trước: tạo đơn không truyền `assigned_reviewer` trong body → vẫn 201, không lỗi.
3. Manual trên dev: gán role `unit_head` cho 1 account qua API RBAC admin, đặt họ vào phòng ban qua `UserDepartmentPositionModel` → tạo đơn từ nhân viên cùng phòng, cùng chi nhánh → nhận thông báo tạo đơn mới. Duyệt đơn → người tạo đơn, người duyệt (nếu khác quản lý trực tiếp thì cả 2), và toàn bộ HR (`view_all`) đều nhận thông báo, không ai nhận trùng lặp.
4. `node scripts/seedRbac.js` chạy 2 lần trên dev DB — lần 2 toàn skip.
5. Chạy `node scripts/listApprovalCandidates.js` trên dev DB — xác nhận danh sách in ra hợp lý (không sót người rõ ràng là trưởng bộ phận, không quá nhiều false positive).

---

## 7. Tiến độ

- [x] Bước 1 — `docs/REQUEST-APPROVAL-CHAIN-PLAN.md`
- [x] Bước 2 — Permission constant `hrm.request.review`
- [x] Bước 3 — Helper `src/helpers/approvalChain.js` (`getApprovalChain`, `getManagedUserIds`)
- [x] Bước 4 — `getAccountsWithPermission` trong `src/helpers/rbac.js`
- [x] Bước 5 — `__tests__/approvalChain.test.js` (11 case, pass)
- [x] Bước 6 — Xóa `assigned_reviewer` khỏi `RequestModel`
- [x] Bước 7 — Migrate `RequestController.create`
- [x] Bước 8 — Migrate `RequestController.getAll` (gate permission + `getManagedUserIds`, giao đúng với `search` thay vì ghi đè)
- [x] Bước 9 — Migrate `RequestController.review` (authorization động + thông báo 3 nhóm, dedupe theo accountId)
- [x] Bước 10 — Đổi mục đích endpoint `eligible-reviewers`; xóa `getEligibleReviewers` cũ khỏi `requestUtils.js`
- [x] Bước 11 — Role `unit_head` trong `scripts/seedRbac.js`
- [x] Bước 12 — `scripts/listApprovalCandidates.js` (chỉ liệt kê, không ghi DB)
- [x] Bước 13 — Test `requestControllerCreate.test.js` (bỏ `assigned_reviewer`) + `requestApprovalFlow.test.js` mới (7 case: getAll scope, review authorization, dedupe/self-exclude notification)
- [x] Bước 14 — `npm test` toàn bộ pass (10 suites / 84 tests, chạy lặp lại nhiều lần để loại flaky)

**Hoàn thành 2026-07-07.** Ngoài 14 bước, phát hiện và sửa thêm 1 test-infra bug trong lúc làm: `MongoMemoryReplSet` + transaction chạm collection lần đầu (vd `HolidayModel`) gây lỗi ngẫu nhiên `Unable to acquire IX lock ... within 5ms` do race với `mongoose.autoIndex` chạy nền — fix bằng cách gọi `Promise.all(Object.values(mongoose.connection.models).map(m => m.init()))` trong `beforeAll` của cả `requestControllerCreate.test.js` và `requestApprovalFlow.test.js` trước khi test chạy. Cũng cập nhật `src/docs/request.yaml` (OpenAPI) cho khớp API contract mới (bỏ `assigned_reviewer` khỏi body tạo đơn, cập nhật mô tả 3 endpoint liên quan).

**Còn lại — việc vận hành thủ công (không tự động hóa được, cần môi trường dev/prod thật):**
- Mục 6.3: manual trên dev — gán role `unit_head`, tạo đơn, duyệt đơn, xác nhận thông báo đúng người.
- Mục 6.4: `node scripts/seedRbac.js` chạy 2 lần trên dev DB.
- Mục 6.5: `node scripts/listApprovalCandidates.js` trên dev DB, admin xem và tự gán role cho đúng người.

---

## 8. Bổ sung: tier-2 "quản lý gián tiếp" (`department.manager`) + duyệt 2 người cho nghỉ dài ngày

Đối chiếu `PHÂN QUYỀN V-WORK - Tổng hợp.pdf` (sơ đồ phê duyệt thật của công ty) với thiết kế ở mục 1-7 phát hiện: `getApprovalChain` chỉ suy ra người duyệt qua `UserDepartmentPositionModel` — đúng cho trưởng phòng (thành viên biên chế thật của phòng đó), nhưng **sai bản chất** cho cấp Phó TGĐ: theo PDF, 1 Phó TGĐ phụ trách **nhiều khối không liền nhánh cùng lúc** (vd Phó TGĐ Nguyễn Văn Lam phụ trách Khối KD + Marketing + QTRR + Công Nghệ + CSSP) và **không phải nhân viên biên chế** của bất kỳ khối nào trong đó. Gán họ vào `UserDepartmentPositionModel` chỉ để "lách" cho approval-chain nhận diện được sẽ làm sai lệch dữ liệu nhân sự thật (headcount, danh sách nhân viên, worksheet chấm công).

Đối chiếu cây `department` với PDF còn phát hiện vài lệch cấu trúc khác (TTKD tách khỏi Khối Kinh Doanh, Ban CSSP lệch tầng, thiếu "Trung tâm PTĐT") — **quyết định giữ nguyên cây, không sửa**, vì thiết kế tier-2 dưới đây không phụ thuộc cây phải đúng cấu trúc, chỉ cần field `manager` được gán đúng trên từng phòng ban cụ thể.

### 8.1. `DepartmentModel.manager` — 1 field, không tạo bảng mới

```js
// "Quản lý gián tiếp" (tier-2) — người phụ trách phòng ban này nhưng KHÔNG phải nhân
// viên biên chế ở đây (khác UserDepartmentPositionModel — quan hệ "làm việc tại").
// 1 người có thể là manager của nhiều phòng ban không liền nhánh.
manager: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null }
```

Đã cân nhắc bảng riêng (`DepartmentApproverModel`) nhưng không cần — tier-2 chỉ có đúng 1 người/phòng ban, không có kịch bản nhiều người cùng cấp. Admin gán qua `PUT /department/update/:id` (tái dùng endpoint có sẵn, thêm field `manager_id` theo đúng pattern `parent_id` đã có).

### 8.2. `getApprovalChain` — check tier-2 ở MỌI cấp khi đi lên

Tái dùng đúng query lấy `parent` (đi lên 1 cấp) có sẵn — chỉ thêm `manager` vào projection, không tốn thêm round-trip DB. **Không check `branch_id` cho tier-2** (khác hẳn tier-1) — admin đã gán tường minh (vd Phó TGĐ Lam quản lý cả 3 TTKD Hà Nội/Hải Phòng/HCM), không cần suy luận thêm.

Thứ tự trong 1 cấp: tier-1 được thêm vào `chain` **trước** tier-2 — khớp ghi chú PDF *"Trưởng phòng KD (hoặc GĐTT khi chưa có TPKD)"*: phòng chưa có trưởng phòng thật thì tier-2 tự động trở thành người gần nhất; có cả 2 thì trưởng phòng vẫn ưu tiên báo trước.

### 8.3. `getManagedUserIds` — gộp điểm xuất phát, bỏ branch filter nếu có tier-2

Chỉ phục vụ liệt kê (`getAll`), không phải cổng duyệt thật — `review()` luôn xác thực lại qua `getApprovalChain` theo từng đơn cụ thể, nên không cần chính xác tuyệt đối theo từng tier. Gộp cả 2 điểm xuất phát BFS-xuống (tier-1 qua `UserDepartmentPositionModel`, tier-2 qua `DepartmentModel.manager`); nếu manager có **bất kỳ** phòng ban tier-2 nào thì bỏ hẳn check `branch_id` cho toàn bộ kết quả (nhị phân đơn giản, không cần chính xác theo từng phòng ban).

### 8.4. Duyệt 2 người cho đơn nghỉ dài ngày (`request_type: "leave"` && `total_days > 3`)

**Quy tắc:** cần **2 người khác nhau bất kỳ** trong `getApprovalChain(request.user_id)` (không phân biệt tier, không yêu cầu thứ tự) đã duyệt thì đơn mới thật sự chuyển `status: "approved"`. Chỉ cần **1 người từ chối** là đơn bị từ chối ngay, không chờ người còn lại.

**Admin/HR (`hrm.request.review_all`) KHÔNG bypass yêu cầu 2 người** — ban đầu thiết kế cho bypass hoàn toàn (duyệt xong ngay 1 lần bấm), nhưng đã đổi lại theo yêu cầu thực tế: `review_all` chỉ bypass check "phải nằm trong chuỗi phê duyệt" (`isInChain`), để admin/HR có thể duyệt đơn của bất kỳ ai kể cả ngoài chuỗi tổ chức — nhưng với đơn nghỉ dài ngày, 1 mình admin cũng chỉ tính là 1 trong 2 người, không được tự ý duyệt xong một mình. Cần 2 tài khoản khác nhau duyệt (bất kỳ tổ hợp: 2 admin, 1 admin + 1 manager, 2 manager...).

Field mới trên `RequestModel` (base schema, dùng chung mọi loại đơn nhưng chỉ đơn nghỉ dài ngày mới thực sự dùng tới):
```js
approvals: [{ account: { type: ObjId, ref: "account" }, reviewed_at: { type: Date, default: Date.now } }]
```

`RequestController.review()`: nhánh `!needsMultiApproval` (đơn thường, hoặc reject) giữ nguyên hành vi cũ 100%. Nhánh `needsMultiApproval` (`action === "approve" && request_type === "leave" && total_days > 3` — **không còn điều kiện `!canReviewAll`**): kiểm tra `req.account` chưa từng duyệt đơn này (409 nếu đã duyệt rồi), push vào `approvals`; đủ 2 người mới set `status: "approved"` và gọi `handler.onApprove` — **đúng 1 lần**, không gọi ở lượt duyệt đầu. Lượt duyệt đầu (1/2): đơn vẫn `"pending"`, chỉ báo nhẹ cho người tạo đơn (không broadcast đầy đủ như lúc `"approved"` thật sự).

**Race condition + khóa Redis:** đoạn đọc-tính-ghi `approvals` không an toàn nếu 2 người duyệt gần như đồng thời — cả 2 đọc `approvals` cũ, cùng push, có thể mất 1 lượt hoặc (nghiêm trọng hơn) cả 2 cùng nghĩ mình là người thứ 2 nên cùng gọi `handler.onApprove` (trừ phép/tạo WorkSheet 2 lần). Fix bằng `acquireRequestReviewLock(requestId)` trong `src/helpers/requestUtils.js` — mirror đúng pattern `acquireUserLeaveLock` ở `src/helpers/leaveBalance.js` (Redis `SET key value PX ttl NX` + retry, namespaced theo `ENV_PREFIX`).

**Điểm quan trọng dễ bug nếu làm ẩu:** phải khóa Redis **TRƯỚC KHI mở MongoDB transaction**, không phải khóa 1 đoạn ở giữa transaction đã mở sẵn. MongoDB transaction mặc định dùng `readConcern: "snapshot"` — snapshot cố định từ lần đọc đầu tiên trong transaction; nếu mở transaction/đọc `request` trước rồi mới khóa, "đọc lại request bên trong cùng transaction" vẫn trả về snapshot cũ, không thấy được lượt duyệt mà transaction khác vừa commit — khóa trở thành vô nghĩa. Cách làm đúng (đã áp dụng): pre-check nhẹ *ngoài* transaction để biết đơn có rơi vào nhánh cần khóa không (`request_type`, `total_days` bất biến sau khi tạo nên pre-check không có nguy cơ TOCTOU) → tính `canReviewAll` → acquire lock nếu cần → **rồi mới** `session.startTransaction()` và đọc `request` lần đầu (đã ở trong snapshot mới nhất, sau khi có lock).

Cache `getApprovalChain` bằng Redis — **không làm trong đợt này**, để sau khi đo hiệu năng thực tế mới quyết định.

### 8.5. Tiến độ bổ sung

- [x] Field `manager` trên `DepartmentModel`
- [x] `manager_id` trong `DepartmentPositionController.updateDepartment`
- [x] `getApprovalChain` — tier-2 ở mọi cấp, tier-1 trước tier-2 cùng cấp
- [x] `getManagedUserIds` — gộp tier-1 + tier-2, bỏ branch filter nếu có tier-2
- [x] Test tier-2 trong `__tests__/approvalChain.test.js` (5 case mới, tổng 16 case, pass)
- [x] Field `approvals` trên `RequestModel`
- [x] `acquireRequestReviewLock` trong `src/helpers/requestUtils.js`
- [x] `RequestController.review()` — nhánh duyệt 2 người, khóa Redis trước khi mở transaction
- [x] Test trong `__tests__/requestApprovalFlow.test.js`: tier-2 reviewer (1 case) + duyệt 2 người/race (7 case) — tổng file 15 case, pass, chạy lặp lại nhiều lần không flaky
- [x] `npm test` toàn bộ + lint (12 suites / 108 tests, chạy lặp lại 3 lần không flaky; lint sạch trên mọi file đụng tới ngoại trừ `DepartmentPositionController.js` — nợ lint indentation có sẵn từ trước, xác nhận qua git-stash baseline: 163 lỗi trước và sau khi sửa)
- [x] **Sửa lại (2026-07-09):** bỏ `!canReviewAll` khỏi điều kiện `needsMultiApproval` — admin/HR không còn tự duyệt xong đơn nghỉ dài ngày 1 mình, chỉ tính là 1 trong 2 người. Cập nhật test "admin duyệt 1 lần là xong" → giờ assert vẫn `pending` sau 1 lượt admin duyệt, thêm test "2 admin khác nhau duyệt đủ 2 lượt mới approved". Tổng `requestApprovalFlow.test.js` giờ 16 case, `npm test` 109/109 pass.

**Hoàn thành 2026-07-09.**
