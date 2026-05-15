/**
 * Seed cây tổ chức VNFITE Holdings Group
 * Chạy: node scripts/seedOrgTree.js
 *
 * Script tạo toàn bộ cây theo sơ đồ cơ cấu tổ chức.
 * An toàn: chỉ tạo node chưa tồn tại (kiểm tra theo department_code).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const DepartmentModel = require("../src/models/DepartmentModel");

const connectDB = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Kết nối MongoDB thành công");
};

// Cây tổ chức (depth-first, parent phải khai báo trước con)
// code phải unique toàn hệ thống
const TREE = [
    // ─── Cấp 1: Tập đoàn ───
    { code: "VNFITE-HLD",  name: "VNFITE Holdings Group",          type: "holding",    parent: null },

    // ─── Cấp 2: Ban lãnh đạo ───
    { code: "HDQT",        name: "Hội Đồng Quản Trị",              type: "board",      parent: "VNFITE-HLD" },
    { code: "BDH",         name: "Ban Điều Hành",                  type: "board",      parent: "VNFITE-HLD" },

    // ─── Cấp 3: Dưới Ban Điều Hành ───
    { code: "BPC",         name: "Ban Pháp Chế",                   type: "department", parent: "BDH" },
    { code: "BCSP",        name: "Ban Chính Sách Sản Phẩm",        type: "department", parent: "BDH" },
    { code: "BKSNB",       name: "Ban Kiểm Soát Nội Bộ",           type: "department", parent: "BDH" },

    // ─── Cấp 3: Khối Quản Trị Tập Đoàn ───
    { code: "KHOI-QTTD",   name: "Khối Quản Trị Tập Đoàn",        type: "division",   parent: "VNFITE-HLD" },

    // ─── Cấp 4: Front Office / Back Office ───
    { code: "FRONT",       name: "Front Office",                   type: "division",   parent: "KHOI-QTTD" },
    { code: "BACK",        name: "Back Office",                    type: "division",   parent: "KHOI-QTTD" },

    // ─── Cấp 5: Các khối thuộc Front Office ───
    { code: "K-MKT",       name: "Khối Marketing",                 type: "department", parent: "FRONT" },
    { code: "K-KD",        name: "Khối Kinh Doanh",                type: "department", parent: "FRONT" },

    // ─── Cấp 5: Các khối thuộc Back Office ───
    { code: "K-QTRR",      name: "Khối Quản Trị Rủi Ro",          type: "department", parent: "BACK" },
    { code: "K-KTTC",      name: "Khối Kế Toán, Tài Chính Nguồn Vốn", type: "department", parent: "BACK" },
    { code: "K-CN",        name: "Khối Công Nghệ",                 type: "department", parent: "BACK" },
    { code: "K-VH",        name: "Khối Vận Hành",                  type: "department", parent: "BACK" },
    { code: "K-NS",        name: "Khối Nhân Sự",                   type: "department", parent: "BACK" },

    // ─── Cấp 3: Chi nhánh & TTKD ───
    { code: "KHOI-CN",     name: "Chi Nhánh & TTKD",              type: "division",   parent: "VNFITE-HLD" },

    // ─── Cấp 4: Chi nhánh cụ thể ───
    { code: "TTKD-HN",     name: "TTKD Hà Nội",                   type: "branch",     parent: "KHOI-CN", address: "Hà Nội" },
    { code: "TTKD-HP",     name: "TTKD Hải Phòng",                type: "branch",     parent: "KHOI-CN", address: "Hải Phòng" },
    { code: "TTKD-HCM",    name: "TTKD Hồ Chí Minh",             type: "branch",     parent: "KHOI-CN", address: "Hồ Chí Minh" },
];

const seed = async () => {
    await connectDB();

    const codeToId = {};
    let created = 0;
    let skipped = 0;

    for (const node of TREE) {
        const existing = await DepartmentModel.findOne({ department_code: node.code });
        if (existing) {
            codeToId[node.code] = existing._id;
            console.log(`⏭  Bỏ qua (đã có): ${node.code} — ${node.name}`);
            skipped++;
            continue;
        }

        const parentId = node.parent ? codeToId[node.parent] : null;
        if (node.parent && !parentId) {
            console.error(`❌ Lỗi: parent "${node.parent}" của "${node.code}" chưa được tạo`);
            process.exit(1);
        }

        const doc = await DepartmentModel.create({
            department_name: node.name,
            department_code: node.code,
            type: node.type,
            address: node.address || "",
            parent: parentId,
        });

        codeToId[node.code] = doc._id;
        console.log(`✅ Tạo: ${node.code} — ${node.name} [${node.type}]`);
        created++;
    }

    console.log(`\n🎉 Hoàn thành: tạo mới ${created}, bỏ qua ${skipped} node đã tồn tại`);
    process.exit(0);
};

seed().catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exit(1);
});
