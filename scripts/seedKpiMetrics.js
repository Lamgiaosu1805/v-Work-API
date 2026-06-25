require("dotenv").config();
const mongoose = require("mongoose");
const KpiMetricModel = require("../src/models/KpiMetricModel");

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const METRICS = [
  {
    code: "investment_revenue",
    name: "Doanh số đầu tư (Vào)",
    group: "output",
    source: "auto",
    auto_source: "investment_revenue",
    unit: "VND",
    description: "Tổng giá trị khoản đầu tư mới trong kỳ. Nguồn: investments.amount.",
    order: 1
  },
  {
    code: "net_revenue",
    name: "Doanh số NET (Vào − Ra)",
    group: "output",
    source: "auto",
    auto_source: "fluctuation_net",
    unit: "VND",
    description: "Dòng tiền NET = Tổng Vào − Tổng Ra. Nguồn: fluctuation_histories.",
    order: 2
  },
  {
    code: "cif_new",
    name: "CIF mới",
    group: "output",
    source: "auto",
    auto_source: "cif",
    unit: "KH",
    description: "Số khách hàng mới đăng ký trong kỳ. Nguồn: customers status=registered.",
    order: 3
  },
  {
    code: "ekyc",
    name: "eKYC thành công",
    group: "output",
    source: "auto",
    auto_source: "ekyc",
    unit: "KH",
    description: "Số KH hoàn thành xác minh eKYC. Nguồn: customers status=kyc_verified.",
    order: 4
  },
  {
    code: "active_investor",
    name: "KH đầu tư đang active",
    group: "output",
    source: "auto",
    auto_source: "active_investor",
    unit: "KH",
    description: "Số KH có khoản đầu tư đang active cuối kỳ. Nguồn: investments status=active.",
    order: 5
  },

  {
    code: "telesale_call",
    name: "Cuộc gọi telesale",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "cuộc gọi",
    description: "Số cuộc gọi telesale thực hiện trong ngày.",
    order: 10
  },
  {
    code: "sms_zalo_email",
    name: "SMS / Zalo / Email",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "tin nhắn",
    description: "Số tin nhắn SMS, Zalo, Email gửi đến khách hàng trong ngày.",
    order: 11
  },
  {
    code: "merchant_registered",
    name: "Merchant đăng ký",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "merchant",
    description: "Số merchant mới đăng ký trong kỳ.",
    order: 12
  },
  {
    code: "merchant_active",
    name: "Merchant active",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "merchant",
    description: "Số merchant đang hoạt động tích cực cuối kỳ.",
    order: 13
  },
  {
    code: "ctv_registered",
    name: "CTV đăng ký",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "CTV",
    description: "Số cộng tác viên mới đăng ký trong kỳ.",
    order: 14
  },
  {
    code: "ctv_active",
    name: "CTV active",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "CTV",
    description: "Số CTV đang hoạt động tích cực cuối kỳ.",
    order: 15
  },
  {
    code: "event_roadshow",
    name: "Event / Roadshow",
    group: "input",
    source: "manual",
    auto_source: null,
    unit: "sự kiện",
    description: "Số sự kiện / roadshow tổ chức hoặc tham gia trong kỳ.",
    order: 16
  }
];

const seed = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const metric of METRICS) {
    const existing = await KpiMetricModel.findOne({ code: metric.code });
    if (existing) {
      console.log(`⏭  Bỏ qua (đã có): ${metric.code} — ${metric.name}`);
      skipped++;
      continue;
    }

    await KpiMetricModel.create(metric);
    console.log(`✅ Tạo: [${metric.group}/${metric.source}] ${metric.code} — ${metric.name}`);
    created++;
  }

  console.log(`\n🎉 Hoàn thành: tạo mới ${created}, bỏ qua ${skipped} metric đã tồn tại`);
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
