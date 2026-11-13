import "dotenv/config";
import mongoose from "mongoose";
import AppModel from "../src/models/AppModel";
import BranchModel from "../src/models/BranchModel";
import CustomerModel from "../src/models/CustomerModel";
import DepartmentModel from "../src/models/DepartmentModel";
import InvestmentModel from "../src/models/InvestmentModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import UserInfoModel from "../src/models/UserInfoModel";

// Khảo sát (read-only) trước khi làm báo cáo ngày / đánh giá theo TTKD — xem docs/CRM-DAILY-SALES-REPORT-PLAN.md mục 3.6.
// Trả lời: Sale đang giữ khách có thuộc đúng 1 TTKD không, chi nhánh (branches) có khớp không, doanh số rơi vào TTKD nào.
// Không in dữ liệu cá nhân khách hàng — chỉ đếm.
// Chạy: npx ts-node --transpile-only scripts/surveyKpiOrgAssignment.ts [--app=tikluy]

interface DeptLean {
  _id: mongoose.Types.ObjectId;
  department_name: string;
  department_code: string;
  type: string;
  parent: mongoose.Types.ObjectId | null;
  manager: mongoose.Types.ObjectId | null;
}

const appArg = process.argv.find((a) => a.startsWith("--app="));
const APP_CODE = appArg ? appArg.split("=")[1] : "tikluy";

async function survey(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công\n");

  const app = await AppModel.findOne({ code: APP_CODE }).select("_id code").lean();
  if (!app) throw new Error(`Không tìm thấy app "${APP_CODE}"`);

  // ─── Cây tổ chức ───
  const depts = (await DepartmentModel.find({ isDeleted: false })
    .select("department_name department_code type parent manager")
    .lean()) as unknown as DeptLean[];
  const deptById = new Map(depts.map((d) => [String(d._id), d]));
  const deptPath = (d: DeptLean): string => {
    const codes: string[] = [];
    let cur: DeptLean | undefined = d;
    while (cur) {
      codes.unshift(cur.department_code);
      cur = cur.parent ? deptById.get(String(cur.parent)) : undefined;
    }
    return codes.join(" > ");
  };

  const memberships = await UserDepartmentPositionModel.find({ isDeleted: false })
    .select("user department")
    .lean();
  const deptsOfUser = new Map<string, Set<string>>();
  const memberCount = new Map<string, number>();
  memberships.forEach((m) => {
    const userId = String(m.user);
    const deptId = String(m.department);
    if (!deptsOfUser.has(userId)) deptsOfUser.set(userId, new Set());
    deptsOfUser.get(userId)!.add(deptId);
    memberCount.set(deptId, (memberCount.get(deptId) ?? 0) + 1);
  });
  const deptLabel = (userId: string): string => {
    const ids = deptsOfUser.get(userId);
    if (!ids) return "(không thuộc phòng ban nào)";
    return [...ids]
      .map((id) => deptById.get(id)?.department_code ?? "?")
      .sort()
      .join(" + ");
  };

  console.log("--- Đơn vị kinh doanh trong cây tổ chức (type=branch hoặc dưới KHOI-CN/K-KD) ---");
  depts
    .map((d) => ({ d, path: deptPath(d) }))
    .filter(({ d, path }) => d.type === "branch" || /KHOI-CN|K-KD|TTKD/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach(({ d, path }) => {
      console.log(
        `  ${path} | ${d.department_name} | type=${d.type} | thành viên=${memberCount.get(String(d._id)) ?? 0} | người phụ trách=${d.manager ? "có" : "CHƯA"}`
      );
    });

  // ─── Danh mục chi nhánh (HRM) ───
  const branches = await BranchModel.find({ isDeleted: false })
    .select("branch_name branch_code")
    .lean();
  const users = await UserInfoModel.find({ isDeleted: false }).select("branch_id").lean();
  const usersPerBranch = new Map<string, number>();
  users.forEach((u) => {
    const key = u.branch_id ? String(u.branch_id) : "null";
    usersPerBranch.set(key, (usersPerBranch.get(key) ?? 0) + 1);
  });
  console.log("\n--- Danh mục chi nhánh (branches, qua user_info.branch_id) ---");
  branches.forEach((b) =>
    console.log(
      `  ${b.branch_code} | ${b.branch_name} | nhân sự=${usersPerBranch.get(String(b._id)) ?? 0}`
    )
  );
  console.log(`  Nhân sự chưa gán chi nhánh: ${usersPerBranch.get("null") ?? 0}/${users.length}`);

  // ─── Sale đang giữ khách của app ───
  const customersBySale = await CustomerModel.aggregate([
    { $match: { app_id: app._id, isDeleted: false } },
    { $group: { _id: "$referred_by", n: { $sum: 1 } } }
  ]);
  const totalCustomers = customersBySale.reduce((s, r) => s + r.n, 0);
  const saleRows = customersBySale.filter((r) => r._id);
  const unassignedCustomers = customersBySale.find((r) => !r._id)?.n ?? 0;
  console.log(`\n--- Khách ${APP_CODE.toUpperCase()} ---`);
  console.log(
    `  Tổng khách: ${totalCustomers} | chưa có Sale (marketing/đại lý): ${unassignedCustomers}`
  );
  console.log(`  Sale đang giữ khách: ${saleRows.length}`);

  const noDeptSales = saleRows.filter((r) => !deptsOfUser.has(String(r._id)));
  const multiDeptSales = saleRows.filter((r) => (deptsOfUser.get(String(r._id))?.size ?? 0) > 1);
  console.log(
    `  ↳ không thuộc phòng ban nào: ${noDeptSales.length} | thuộc >1 phòng ban: ${multiDeptSales.length}`
  );

  const customersByDept = new Map<string, number>();
  saleRows.forEach((r) => {
    const label = deptLabel(String(r._id));
    customersByDept.set(label, (customersByDept.get(label) ?? 0) + r.n);
  });
  console.log("  Khách theo đơn vị của Sale đang giữ:");
  [...customersByDept.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, n]) => console.log(`    ${label}: ${n}`));

  const needFix = [...noDeptSales, ...multiDeptSales].map((r) => r._id);
  if (needFix.length) {
    const staff = await UserInfoModel.find({ _id: { $in: needFix } })
      .select("ma_nv full_name")
      .lean();
    console.log(`  Sale cần gán lại đơn vị (tối đa 20/${needFix.length}):`);
    staff
      .slice(0, 20)
      .forEach((s) => console.log(`    ${s.ma_nv} | ${s.full_name} | ${deptLabel(String(s._id))}`));
  }

  // ─── Doanh số đầu tư theo đơn vị của Sale hưởng hoa hồng ───
  const investments = await InvestmentModel.aggregate([
    { $match: { app_id: app._id, isDeleted: false } },
    {
      $group: {
        _id: { sale: "$commission.sale_id", status: "$status" },
        n: { $sum: 1 },
        amount: { $sum: "$amount" },
        from: { $min: "$invested_at" },
        to: { $max: "$invested_at" }
      }
    }
  ]);
  const byStatus = new Map<string, number>();
  const byDept = new Map<string, { n: number; amount: number }>();
  let from: Date | null = null;
  let to: Date | null = null;
  investments.forEach((r) => {
    byStatus.set(r._id.status, (byStatus.get(r._id.status) ?? 0) + r.n);
    const label = r._id.sale ? deptLabel(String(r._id.sale)) : "(không Sale — marketing/đại lý)";
    const cur = byDept.get(label) ?? { n: 0, amount: 0 };
    byDept.set(label, { n: cur.n + r.n, amount: cur.amount + r.amount });
    if (!from || r.from < from) from = r.from;
    if (!to || r.to > to) to = r.to;
  });
  console.log(`\n--- Khoản đầu tư ${APP_CODE.toUpperCase()} (invested_at ${from} → ${to}) ---`);
  console.log(`  Theo trạng thái: ${JSON.stringify(Object.fromEntries(byStatus))}`);
  console.log("  Theo đơn vị của Sale hưởng hoa hồng (số khoản | tổng tiền):");
  [...byDept.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .forEach(([label, v]) =>
      console.log(
        `    ${label}: ${v.n} | ${Math.round(v.amount / 1e6).toLocaleString("vi-VN")} triệu`
      )
    );

  await mongoose.disconnect();
}

survey().catch((err) => {
  console.error("❌ Lỗi:", err);
  process.exit(1);
});
