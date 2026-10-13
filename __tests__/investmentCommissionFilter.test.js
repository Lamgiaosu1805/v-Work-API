const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

const InvestmentModel = require("../src/models/InvestmentModel");
const CustomerModel = require("../src/models/CustomerModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const AppModel = require("../src/models/AppModel");
const InvestmentController = require("../src/controllers/InvestmentController");
const { parseCommissionFilter } = require("../src/helpers/commissionFilter");

const TZ = "Asia/Ho_Chi_Minh";
const vn = (value) => moment.tz(value, "YYYY-MM-DD HH:mm", TZ).toDate();

const accountA = new mongoose.Types.ObjectId();
const accountB = new mongoose.Types.ObjectId();
const saleA = new mongoose.Types.ObjectId();
const saleB = new mongoose.Types.ObjectId();

let mongod;
let app;
let customers;

function buildApp() {
  const server = express();
  server.use((req, _res, next) => {
    req.account = { _id: accountA };
    next();
  });
  server.get("/my-commission", InvestmentController.getMyCommission);
  server.get("/staff-commission", InvestmentController.getStaffCommission);
  return server;
}

function saleInfo(_id, id_account, ma_nv) {
  return {
    _id,
    full_name: `Sale ${ma_nv}`,
    cccd: `0011990${ma_nv}`,
    phone_number: `09000${ma_nv}`,
    sex: 1,
    date_of_birth: new Date(1995, 0, 1),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account,
    ma_nv,
    employment_type: "fulltime"
  };
}

function commission(saleId, grantedAt) {
  return { amount: 25000, sale_id: saleId, granted_at: grantedAt };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();

  await UserInfoModel.create([
    saleInfo(saleA, accountA, "CMA01"),
    saleInfo(saleB, accountB, "CMB01")
  ]);
  const appDoc = await AppModel.create({ name: "TikLuy", code: "tikluy-commission-test" });

  customers = await CustomerModel.create([
    {
      app_id: appDoc._id,
      phone_number: "0911000001",
      // eKYC trong tháng 10, CIF sang tháng 11 — tháng 10 chỉ được tính eKYC
      ekyc_commission: commission(saleA, vn("2026-10-05 10:00")),
      cif_commission: commission(saleA, vn("2026-11-02 09:00"))
    },
    {
      app_id: appDoc._id,
      phone_number: "0911000002",
      cif_commission: commission(saleA, vn("2026-10-20 09:00"))
    },
    {
      app_id: appDoc._id,
      phone_number: "0911000003",
      ekyc_commission: commission(saleB, vn("2026-10-06 09:00"))
    },
    {
      app_id: appDoc._id,
      phone_number: "0911000004",
      ekyc_commission: commission(saleA, vn("2026-09-30 23:30"))
    }
  ]);

  const investment = (externalId, investedAt, period, net) => ({
    app_id: appDoc._id,
    customer_id: customers[0]._id,
    external_investment_id: externalId,
    product_name: "LỘC VÀNG",
    amount: 4_000_000,
    term_type: "month",
    term_value: 1,
    interest_rate: 6,
    invested_at: investedAt,
    maturity_at: moment(investedAt).add(1, "month").toDate(),
    commission: {
      receiver_type: "sale",
      sale_id: saleA,
      period_month: period.month,
      period_year: period.year,
      net_amount: net,
      gross_amount: net,
      status: "pending"
    }
  });

  await InvestmentModel.create([
    investment("INV-1", vn("2026-10-09 10:00"), { month: 10, year: 2026 }, 4988),
    investment("INV-2", vn("2026-09-28 10:00"), { month: 9, year: 2026 }, 1000),
    investment("INV-3", vn("2026-10-01 00:10"), { month: 10, year: 2026 }, 2000)
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("parseCommissionFilter", () => {
  const october = { month: "10", year: "2026" };

  test("theo tháng, không truyền type thì lấy đủ 3 loại", () => {
    const result = parseCommissionFilter(october);
    expect(result.period).toEqual({ month: 10, year: 2026 });
    expect(result.types).toEqual(["cif", "ekyc", "investment"]);
  });

  test("có dateFrom + dateTo thì bỏ qua month/year", () => {
    const result = parseCommissionFilter({
      ...october,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-15"
    });
    expect(result.period).toEqual({ date_from: "2026-09-01", date_to: "2026-09-15" });
  });

  test("nhận type dạng mảng và dạng phân tách dấu phẩy", () => {
    expect(parseCommissionFilter({ ...october, type: ["ekyc", "cif"] }).types).toEqual([
      "cif",
      "ekyc"
    ]);
    expect(parseCommissionFilter({ ...october, type: " Investment , ekyc" }).types).toEqual([
      "ekyc",
      "investment"
    ]);
  });

  test.each([
    [{ ...october, type: "abc" }],
    [{ ...october, dateFrom: "2026-10-01" }],
    [{ ...october, dateFrom: "2026-10-05", dateTo: "2026-10-01" }],
    [{ ...october, dateFrom: "2026/10/01", dateTo: "2026-10-05" }],
    [{ ...october, dateFrom: "2026-02-30", dateTo: "2026-03-05" }],
    [{ month: "13", year: "2026" }],
    [{ month: "", year: "2026" }]
  ])("báo lỗi với input không hợp lệ %j", (query) => {
    expect(parseCommissionFilter(query).error).toEqual(expect.any(String));
  });
});

describe("GET /investments/my-commission", () => {
  test("theo tháng: giữ hành vi cũ và không tính CIF của tháng khác", async () => {
    const res = await request(app).get("/my-commission").query({ month: 10, year: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.period).toEqual({ month: 10, year: 2026 });
    expect(res.body.summary).toMatchObject({ count: 2, total_net: 6988 });
    expect(res.body.customer_commission_summary).toMatchObject({ cif_count: 1, ekyc_count: 1 });

    const first = res.body.customer_commissions.find((c) => c.phone_number === "0911000001");
    expect(first.ekyc_commission).not.toBeNull();
    expect(first.cif_commission).toBeNull();
  });

  test("theo khoảng ngày: lọc theo invested_at / granted_at", async () => {
    const res = await request(app)
      .get("/my-commission")
      .query({ date_from: "2026-09-28", date_to: "2026-10-05" });

    expect(res.status).toBe(200);
    expect(res.body.period).toEqual({ date_from: "2026-09-28", date_to: "2026-10-05" });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.summary).toMatchObject({ count: 2, total_net: 3000 });
    expect(res.body.customer_commission_summary).toMatchObject({ cif_count: 0, ekyc_count: 2 });
  });

  test("ranh giới ngày tính theo giờ VN", async () => {
    const res = await request(app)
      .get("/my-commission")
      .query({ date_from: "2026-10-01", date_to: "2026-10-01" });

    expect(res.status).toBe(200);
    // INV-3 lúc 00:10 ngày 01/10 (VN) được tính; eKYC 23:30 ngày 30/09 (VN) thì không
    expect(res.body.summary).toMatchObject({ count: 1, total_net: 2000 });
    expect(res.body.customer_commission_summary.ekyc_count).toBe(0);
  });

  test("type=ekyc: bỏ đầu tư và CIF khỏi cả tổng lẫn danh sách", async () => {
    const res = await request(app)
      .get("/my-commission")
      .query({ month: 10, year: 2026, type: "ekyc" });

    expect(res.status).toBe(200);
    expect(res.body.types).toEqual(["ekyc"]);
    expect(res.body.data).toEqual([]);
    expect(res.body.summary).toMatchObject({ count: 0, total_net: 0 });
    expect(res.body.customer_commission_summary).toMatchObject({ cif_count: 0, ekyc_count: 1 });
    expect(res.body.customer_commissions.every((c) => c.cif_commission === null)).toBe(true);
  });

  test("type=investment,cif: không trả eKYC", async () => {
    const res = await request(app)
      .get("/my-commission")
      .query({ month: 10, year: 2026, type: "investment,cif" });

    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBe(2);
    expect(res.body.customer_commission_summary).toMatchObject({ cif_count: 1, ekyc_count: 0 });
    expect(res.body.customer_commissions.map((c) => c.phone_number)).toEqual(["0911000002"]);
  });

  test("query không hợp lệ trả 400", async () => {
    const res = await request(app).get("/my-commission").query({ type: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Loại hoa hồng không hợp lệ/);
  });
});

describe("GET /investments/staff-commission", () => {
  test("tổng quan theo khoảng ngày + type", async () => {
    const res = await request(app)
      .get("/staff-commission")
      .query({ date_from: "2026-10-01", date_to: "2026-10-31", type: "ekyc" });

    expect(res.status).toBe(200);
    expect(res.body.period).toEqual({ date_from: "2026-10-01", date_to: "2026-10-31" });
    const bySale = Object.fromEntries(res.body.data.map((row) => [row.sale_id, row]));
    expect(bySale[String(saleA)]).toMatchObject({ ekyc_count: 1, cif_count: 0, inv_count: 0 });
    expect(bySale[String(saleB)]).toMatchObject({ ekyc_count: 1 });
  });

  test("chi tiết 1 sale theo khoảng ngày", async () => {
    const res = await request(app)
      .get("/staff-commission")
      .query({ sale_id: String(saleA), date_from: "2026-09-01", date_to: "2026-10-31" });

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ count: 3, total_net: 7988 });
    expect(res.body.customer_commission_summary).toMatchObject({ cif_count: 1, ekyc_count: 2 });
  });
});
