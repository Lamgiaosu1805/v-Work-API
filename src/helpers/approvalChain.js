const UserInfoModel = require("../models/UserInfoModel");
const AccountModel = require("../models/AccountModel");
const DepartmentModel = require("../models/DepartmentModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const { can } = require("./rbac");
const { PERMISSION } = require("../constants");

// Không nhận session — đọc dữ liệu tổ chức "hiện hành" (ai thuộc phòng ban nào,
// ai có quyền gì), không cần nhất quán theo snapshot của 1 transaction cụ thể.

// Đi lên: trả về mảng người duyệt hợp lệ, gần nhất trước (level 0 = chính phòng ban của employee).
// stopAtFirstMatch=true: dừng ngay khi tìm được match ở 1 cấp, không đi tiếp lên cao hơn
// — dùng cho create() (chỉ cần người gần nhất để báo, không cần cả chuỗi).
// getAll()/review() gọi mặc định (false) vì cần TOÀN BỘ chuỗi.
async function getApprovalChain(userInfoId, { stopAtFirstMatch = false } = {}) {
  const employee = await UserInfoModel.findById(userInfoId, { branch_id: 1, isDeleted: 1 });
  if (!employee || employee.isDeleted) return [];

  const memberships = await UserDepartmentPositionModel.find({
    user: userInfoId,
    isDeleted: false
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
      department: { $in: newFrontier },
      isDeleted: false,
      user: { $ne: userInfoId }
    }).distinct("user");

    if (candidateUserIds.length) {
      const candidates = await UserInfoModel.find(
        { _id: { $in: candidateUserIds }, isDeleted: false },
        { branch_id: 1, full_name: 1, id_account: 1 }
      );

      // Lọc branch_id trước (rẻ, không cần I/O) để giảm số candidate phải check permission
      const branchMatched = candidates.filter(
        (c) => employee.branch_id && c.branch_id && employee.branch_id.equals(c.branch_id)
      );

      const accounts = await AccountModel.find(
        { _id: { $in: branchMatched.map((c) => c.id_account) }, isDeleted: false },
        { role: 1 }
      );
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

    // Tier 2: field `manager` ngay trên phòng ban ở cấp này — tái dùng đúng query
    // lấy `parent` (đi lên 1 cấp) bên dưới, chỉ thêm `manager` vào projection, không
    // tốn thêm round-trip DB nào. KHÔNG check branch_id — admin đã gán tường minh
    // (vd 1 Phó TGĐ phụ trách nhiều chi nhánh cùng lúc), không cần suy luận thêm.
    const depts = await DepartmentModel.find(
      { _id: { $in: newFrontier }, isDeleted: false },
      { parent: 1, manager: 1 }
    );
    const managerIds = [
      ...new Set(
        depts
          .map((d) => d.manager)
          .filter(Boolean)
          .map(String)
      )
    ].filter((id) => !seenUsers.has(id));
    if (managerIds.length) {
      const managerInfos = await UserInfoModel.find(
        { _id: { $in: managerIds }, isDeleted: false },
        { full_name: 1, id_account: 1 }
      );
      managerInfos.forEach((c) => {
        if (seenUsers.has(String(c._id))) return;
        seenUsers.add(String(c._id));
        chain.push({ userInfoId: c._id, accountId: c.id_account, full_name: c.full_name });
      });
    }

    if (stopAtFirstMatch && chain.length) break;

    // Lên 1 cấp
    frontier = depts
      .map((d) => d.parent)
      .filter(Boolean)
      .map(String);
  }

  return chain; // thứ tự: gần nhất trước
}

// Chiều ngược lại (đi xuống children thay vì parent), dùng cho getAll — CHỈ phục vụ
// liệt kê, không phải cổng duyệt thật (review() luôn xác thực lại qua getApprovalChain
// theo từng đơn cụ thể) nên không cần chính xác tuyệt đối theo từng tier.
// Khác biệt quan trọng so với getApprovalChain: KHÔNG check lại permission cho từng
// nhân viên cấp dưới — quyền đã được gate 1 lần duy nhất ở getAll() cho chính manager
// gọi API, ở đây chỉ cần lọc theo phòng ban con cháu + khớp branch_id.
async function getManagedUserIds(managerUserInfoId) {
  const manager = await UserInfoModel.findById(managerUserInfoId, { branch_id: 1, isDeleted: 1 });
  if (!manager || manager.isDeleted) return [];

  // Gộp 2 điểm xuất phát: tier-1 (phòng ban họ THUỘC) + tier-2 (phòng ban họ được
  // gán làm manager tường minh). Có bất kỳ phòng ban tier-2 nào thì bỏ hẳn check
  // branch_id cho toàn bộ kết quả — tier-2 vốn ngụ ý phụ trách vượt phạm vi 1 chi
  // nhánh (vd 1 Phó TGĐ quản lý nhiều chi nhánh), không cần suy luận thêm.
  const [ownDepts, managedDepts] = await Promise.all([
    UserDepartmentPositionModel.find({
      user: managerUserInfoId,
      isDeleted: false
    }).distinct("department"),
    DepartmentModel.find({ manager: managerUserInfoId, isDeleted: false }).distinct("_id")
  ]);
  const isTier2Manager = managedDepts.length > 0;
  const startDepts = [...new Set([...ownDepts, ...managedDepts].map(String))];
  if (!startDepts.length) return [];

  const seenDeptIds = new Set(startDepts);
  let frontier = startDepts;

  // BFS xuống: gom toàn bộ phòng ban con cháu (bao gồm chính phòng ban của manager)
  while (frontier.length) {
    const children = await DepartmentModel.find(
      { parent: { $in: frontier }, isDeleted: false },
      { _id: 1 }
    );
    const newIds = children.map((d) => String(d._id)).filter((id) => !seenDeptIds.has(id));
    if (!newIds.length) break;
    newIds.forEach((id) => seenDeptIds.add(id));
    frontier = newIds;
  }

  const members = await UserDepartmentPositionModel.find({
    department: { $in: [...seenDeptIds] },
    isDeleted: false,
    user: { $ne: managerUserInfoId }
  }).distinct("user");
  if (!members.length) return [];

  const employeeFilter = { _id: { $in: members }, isDeleted: false };
  if (!isTier2Manager) employeeFilter.branch_id = manager.branch_id;

  const employees = await UserInfoModel.find(employeeFilter, { _id: 1 });

  return employees.map((e) => e._id);
}

module.exports = { getApprovalChain, getManagedUserIds };
