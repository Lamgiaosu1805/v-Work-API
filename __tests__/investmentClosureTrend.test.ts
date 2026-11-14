import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import DepartmentModel from "../src/models/DepartmentModel";
import InvestmentModel from "../src/models/InvestmentModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildAbility } from "../src/modules/permission";
import { bucketsEndingAt } from "../src/modules/daily-report";
import { buildInvestmentAttribution } from "../src/helpers/kpiAttribution";
import {
  findRenewalTarget,
  isRenewalForm,
  mapHoldingClosure,
  parseTikluyDate
} from "../src/workflows/investment-closure/holding-mapper";
import { syncInvestmentClosures } from "../src/workflows/investment-closure-sync.workflow";
import { AUTO_METRIC_SOURCES } from "../src/workflows/daily-report/auto-metric-sources";
import { getDailyReportSummary } from "../src/workflows/daily-report-board.workflow";
import { getDailyReportTrend } from "../src/workflows/daily-report-trend.workflow";

// Giờ Việt Nam = UTC+7
const vn = (iso: string) => new Date(`${iso}+07:00`);
const id = () => new mongoose.Types.ObjectId();
const M = 1_000_000;

describe("ánh xạ danh mục đầu tư TIKLUY", () => {
  const now = vn("2026-11-13T01:30:00");

  test("đọc ngày TIKLUY theo giờ Việt Nam", () => {
    expect(parseTikluyDate("15/11/2026")).toEqual(vn("2026-11-15T00:00:00"));
    expect(parseTikluyDate("15/11/2026 09:30")).toEqual(vn("2026-11-15T09:30:00"));
    expect(parseTikluyDate("2026-11-15 09:30:00")).toEqual(vn("2026-11-15T09:30:00"));
    expect(parseTikluyDate("2026-11-15T02:30:00Z")).toEqual(vn("2026-11-15T09:30:00"));
    expect(parseTikluyDate("31/02/2026")).toBeNull();
    expect(parseTikluyDate("")).toBeNull();
  });

  test("nhận diện hình thức đáo hạn có tái tục", () => {
    expect(isRenewalForm("Tái tục gốc")).toBe(true);
    expect(isRenewalForm("TÁI TỤC GỐC VÀ LÃI")).toBe(true);
    expect(isRenewalForm("Không tái tục")).toBe(false);
    expect(isRenewalForm("Rút gốc và lãi")).toBe(false);
    expect(isRenewalForm(null)).toBe(false);
  });

  test("chỉ dòng đã tất toán mới thành bản ghi tất toán", () => {
    expect(mapHoldingClosure({ status: 0, investAmount: 10 * M, endDate: "10/11/2026" }, now)).toBe(
      null
    );
    expect(mapHoldingClosure({ status: 2, investAmount: 0, endDate: "10/11/2026" }, now)).toBe(
      null
    );
    // Đáo hạn mà ngày kết thúc còn xa → dữ liệu lạ, bỏ qua
    expect(mapHoldingClosure({ status: 2, investAmount: 10 * M, endDate: "20/11/2026" }, now)).toBe(
      null
    );
    expect(
      mapHoldingClosure(
        {
          status: "2",
          investAmount: "10000000",
          endDate: "10/11/2026",
          totalProfit: 50_000,
          formOfMaturity: "Tái tục gốc"
        },
        now
      )
    ).toEqual({
      type: "matured",
      closed_at: vn("2026-11-10T00:00:00"),
      principal: 10 * M,
      profit: 50_000,
      form_of_maturity: "Tái tục gốc",
      renewed: true,
      date_unknown: false,
      synced_at: now
    });
  });

  test("tất toán trước hạn: ngày kết thúc theo hợp đồng chưa tới → lấy lúc phát hiện, không tái tục", () => {
    expect(
      mapHoldingClosure(
        { status: 1, investAmount: 5 * M, endDate: "01/03/2027", formOfMaturity: "Tái tục gốc" },
        now
      )
    ).toMatchObject({
      type: "early_terminated",
      closed_at: now,
      renewed: false,
      date_unknown: true
    });
  });

  test("khoản tái tục: gần ngày đáo hạn nhất, gốc ≥ 99% gốc cũ", () => {
    const closure = mapHoldingClosure(
      { status: 2, investAmount: 100 * M, endDate: "10/11/2026" },
      now
    )!;
    const candidates = [
      { _id: "xa", amount: 100 * M, invested_at: vn("2026-11-13T00:00:00") },
      { _id: "nho", amount: 50 * M, invested_at: vn("2026-11-10T08:00:00") },
      { _id: "gan", amount: 99 * M, invested_at: vn("2026-11-10T09:00:00") },
      { _id: "vua", amount: 100 * M, invested_at: vn("2026-11-11T00:00:00") }
    ];
    expect(findRenewalTarget(closure, candidates)?._id).toBe("gan");
    expect(findRenewalTarget({ ...closure, type: "early_terminated" }, candidates)).toBeNull();
  });
});

describe("kỳ xu hướng", () => {
  test("tuần báo cáo thứ Sáu → thứ Năm, kỳ cuối tới ngày đang xem", () => {
    // 12/11/2026 là thứ Năm (hết tuần báo cáo), 13/11 là thứ Sáu (đầu tuần mới)
    const weeks = bucketsEndingAt("2026-11-12", "week", 2);
    expect(weeks.map((b) => [b.fromKey, b.toKey, b.label])).toEqual([
      ["2026-10-30", "2026-11-05", "30/10–05/11"],
      ["2026-11-06", "2026-11-12", "06/11–12/11"]
    ]);
    expect(weeks[1].range).toEqual({
      from: vn("2026-11-06T00:00:00"),
      to: vn("2026-11-13T00:00:00")
    });
    expect(bucketsEndingAt("2026-11-13", "week", 2).map((b) => [b.fromKey, b.toKey])).toEqual([
      ["2026-11-06", "2026-11-12"],
      ["2026-11-13", "2026-11-13"]
    ]);
    expect(bucketsEndingAt("2026-11-18", "week", 1)[0]).toMatchObject({
      fromKey: "2026-11-13",
      toKey: "2026-11-18"
    });
  });

  test("tháng dương lịch, qua năm", () => {
    const months = bucketsEndingAt("2026-01-20", "month", 3);
    expect(months.map((b) => [b.fromKey, b.toKey, b.label])).toEqual([
      ["2025-11-01", "2025-11-30", "11/2025"],
      ["2025-12-01", "2025-12-31", "12/2025"],
      ["2026-01-01", "2026-01-20", "01/2026"]
    ]);
  });
});

// ─── Đồng bộ tất toán → tiền ra / tăng net / AUM / tái tục / xu hướng ─────────────────────────

let mongod: MongoMemoryServer;
const ids = { app: id(), cn: id(), hn1: id(), hn2: id(), s1: id(), s2: id() };
const inv: Record<string, any> = {};
const syncAt = vn("2026-11-13T01:30:00");

const holdings: Record<string, any[]> = {
  "kh-a": [
    // Đáo hạn 10/11, tái tục sang khoản A2
    {
      investmentCode: "A1",
      investAmount: 100 * M,
      status: 2,
      endDate: "10/11/2026",
      formOfMaturity: "Tái tục gốc"
    },
    { investmentCode: "A2", investAmount: 100 * M, status: 0, endDate: "10/02/2027" },
    // Tất toán trước hạn — TIKLUY vẫn trả ngày đáo hạn theo hợp đồng
    { investmentCode: "A3", investAmount: 40 * M, status: 1, endDate: "01/03/2027" }
  ],
  "kh-b": [
    {
      investmentCode: "B1",
      investAmount: 60 * M,
      status: 2,
      endDate: "12/11/2026",
      formOfMaturity: "Rút gốc và lãi"
    },
    { investmentCode: "B2", investAmount: 30 * M, status: 0, endDate: "12/02/2027" },
    { investmentCode: "ZZ", investAmount: 5 * M, status: 2, endDate: "01/11/2026" }
  ]
};
const fetchHoldings = async (externalId: string) => holdings[externalId] ?? [];
const companyAbility = () =>
  buildAbility([{ action: "daily_report.view", subject: "DailyReport" }]);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await AppModel.create({ _id: ids.app, name: "TikLuy", code: "tikluy" });
  await DepartmentModel.create([
    {
      _id: ids.cn,
      department_name: "Chi nhánh Hà Nội",
      department_code: "CN-HN",
      type: "division"
    },
    {
      _id: ids.hn1,
      department_name: "TTKD HN1",
      department_code: "TTKD-HN1",
      type: "branch",
      parent: ids.cn
    },
    {
      _id: ids.hn2,
      department_name: "TTKD HN2",
      department_code: "TTKD-HN2",
      type: "branch",
      parent: ids.cn
    }
  ]);
  await UserDepartmentPositionModel.create([
    { user: ids.s1, department: ids.hn1, position: id() },
    { user: ids.s2, department: ids.hn2, position: id() }
  ]);
  await mongoose.connection.collection("user_infos").insertMany([
    { _id: ids.s1, full_name: "Sale Một", ma_nv: "NV001", id_account: id(), isDeleted: false },
    { _id: ids.s2, full_name: "Sale Hai", ma_nv: "NV002", id_account: id(), isDeleted: false }
  ]);

  const [cA, cB] = await CustomerModel.create([
    { app_id: ids.app, phone_number: "0911000001", external_id: "kh-a", referred_by: ids.s1 },
    { app_id: ids.app, phone_number: "0911000002", external_id: "kh-b", referred_by: ids.s2 }
  ]);
  const investment = async (customer: any, code: string, amount: number, investedAt: Date) => {
    inv[code] = await InvestmentModel.create({
      app_id: ids.app,
      customer_id: customer._id,
      external_investment_id: code,
      product_name: "Tích lũy",
      amount,
      term_type: "month",
      term_value: 3,
      interest_rate: 6,
      invested_at: investedAt,
      maturity_at: vn("2027-03-01T00:00:00"),
      kpi_attribution: await buildInvestmentAttribution(customer, null, investedAt)
    });
  };
  await investment(cA, "A3", 40 * M, vn("2026-09-05T09:00:00"));
  await investment(cA, "A1", 100 * M, vn("2026-10-01T09:00:00"));
  await investment(cA, "A2", 100 * M, vn("2026-11-10T08:00:00"));
  await investment(cB, "B1", 60 * M, vn("2026-10-15T09:00:00"));
  await investment(cB, "B2", 30 * M, vn("2026-11-12T10:00:00"));
  // A3 đã được đồng bộ đêm trước (còn mở) → tất toán trước hạn phát hiện đêm nay là ngày thật
  await InvestmentModel.updateOne(
    { _id: inv.A3._id },
    { $set: { holding_synced_at: vn("2026-11-12T01:30:00") } }
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const reload = async (code: string) =>
  (await InvestmentModel.findById(inv[code]._id).lean()) as any;

describe("đồng bộ tất toán", () => {
  test("chạy thử không ghi DB", async () => {
    const result = await syncInvestmentClosures({
      appCode: "tikluy",
      now: syncAt,
      dryRun: true,
      fetchHoldings
    });
    expect(result).toMatchObject({ customers: 2, closed: 3, renewed: 1, renewalLinks: 1 });
    expect((await reload("A1")).closure).toBeNull();
    expect((await reload("A2")).renewal_of).toBeNull();
  });

  test("ghi tất toán, ghi nhận Sale đang giữ khách, nối khoản tái tục, không đổi trạng thái", async () => {
    const result = await syncInvestmentClosures({ appCode: "tikluy", now: syncAt, fetchHoldings });
    expect(result).toEqual({
      customers: 2,
      synced: 2,
      closed: 3,
      renewed: 1,
      renewalLinks: 1,
      unknownCodes: 1,
      // ZZ thiếu ngày bắt đầu / kỳ hạn → không tạo bù được, vẫn là mã lạ
      backfilled: 0,
      backfillRenewals: 0,
      skippedNoTerm: 1,
      skippedRecent: 0,
      backfillRows: [],
      errors: []
    });

    const a1 = await reload("A1");
    expect(a1.status).toBe("active");
    expect(a1.closure).toMatchObject({
      type: "matured",
      closed_at: vn("2026-11-10T00:00:00"),
      principal: 100 * M,
      renewed: true
    });
    expect(String(a1.closure_attribution.sale_id)).toBe(String(ids.s1));
    expect(String(a1.closure_attribution.department_id)).toBe(String(ids.hn1));
    expect(String((await reload("A2")).renewal_of)).toBe(String(inv.A1._id));
    expect((await reload("A3")).closure).toMatchObject({
      type: "early_terminated",
      closed_at: syncAt,
      date_unknown: false
    });
    expect((await reload("B1")).closure).toMatchObject({ renewed: false, principal: 60 * M });
    expect((await reload("B2")).holding_synced_at).toEqual(syncAt);
  });

  test("chạy lại không ghi trùng, khoản đã tất toán không bị tính là mã lạ", async () => {
    const result = await syncInvestmentClosures({ appCode: "tikluy", now: syncAt, fetchHoldings });
    expect(result).toMatchObject({ closed: 0, renewalLinks: 0, unknownCodes: 1, errors: [] });
  });

  test("lỗi gọi TIKLUY của 1 khách không chặn khách khác", async () => {
    const result = await syncInvestmentClosures({
      appCode: "tikluy",
      now: syncAt,
      fetchHoldings: async (externalId) => {
        if (externalId === "kh-a") throw new Error("timeout");
        return holdings[externalId];
      }
    });
    expect(result.synced).toBe(1);
    expect(result.errors).toEqual([{ external_id: "kh-a", message: "timeout" }]);
  });
});

describe("tiền ra, tăng net, AUM, tái tục trên bảng tổng hợp", () => {
  test("cộng theo TTKD, tái tục không tính vào/ra", async () => {
    const summary = await getDailyReportSummary({
      ability: companyAbility(),
      dateKey: "2026-11-13",
      now: vn("2026-11-13T18:00:00")
    });
    const metrics = (unitId: any) =>
      (summary.units.find((u: any) => u.id === String(unitId)) as any).metrics;

    // HN1: vào T11 = 0 (A2 là tái tục), ra = A3 40tr (A1 tái tục không tính)
    expect(metrics(ids.hn1).investment_amount).toMatchObject({ day: 0, mtd: 0, ytd: 140 * M });
    expect(metrics(ids.hn1).investment_outflow).toMatchObject({ day: 40 * M, mtd: 40 * M });
    expect(metrics(ids.hn1).net_growth).toMatchObject({ day: -40 * M, mtd: -40 * M, ytd: 100 * M });
    expect(metrics(ids.hn2).net_growth).toMatchObject({ day: 0, mtd: -30 * M, ytd: 30 * M });
    expect(metrics(ids.cn).net_growth).toMatchObject({ mtd: -70 * M, ytd: 130 * M });

    // AUM cuối ngày 13/11: A2 100tr (HN1) + B2 30tr (HN2)
    expect(metrics(ids.hn1).aum).toMatchObject({ day: 100 * M, mtd: 100 * M });
    expect(summary.totals.metrics.aum.day).toBe(130 * M);

    // Tái tục T11: HN1 100/100, HN2 0/60, cả chi nhánh 100/160
    expect(metrics(ids.hn1).renewal_rate).toMatchObject({ rate_month: 1, pct_month: 1 });
    expect(metrics(ids.hn2).renewal_rate).toMatchObject({ rate_month: 0 });
    expect(metrics(ids.cn).renewal_rate).toMatchObject({
      mtd: 100 * M,
      base: { mtd: 160 * M },
      rate_month: 0.625
    });
  });
});

describe("xu hướng", () => {
  test("tăng net theo tháng, cộng dồn lên chi nhánh", async () => {
    const trend = await getDailyReportTrend({
      ability: companyAbility(),
      metric: "net_growth",
      granularity: "month",
      toKey: "2026-11-13",
      periods: 3
    });
    const series = (unitId: any) =>
      (trend.units.find((u: any) => u.id === String(unitId)) as any).values;

    expect(trend.buckets.map((b: any) => b.label)).toEqual(["09/2026", "10/2026", "11/2026"]);
    expect(series(ids.hn1)).toEqual([40 * M, 100 * M, -40 * M]);
    expect(series(ids.hn2)).toEqual([0, 60 * M, -30 * M]);
    expect(series(ids.cn)).toEqual([40 * M, 160 * M, -70 * M]);
    expect(trend.totals.values).toEqual([40 * M, 160 * M, -70 * M]);
    expect(trend.units.find((u: any) => u.id === String(ids.hn1))).toMatchObject({
      name: "TTKD HN1",
      parent_id: String(ids.cn)
    });
  });

  test("tỷ lệ tái tục theo tháng trả tỷ lệ + tử/mẫu", async () => {
    const trend = await getDailyReportTrend({
      ability: companyAbility(),
      metric: "renewal_rate",
      granularity: "month",
      toKey: "2026-11-13",
      periods: 2
    });
    expect(trend.metric.aggregation).toBe("ratio");
    expect(trend.totals).toEqual({
      values: [null, 0.625],
      numerators: [0, 100 * M],
      bases: [0, 160 * M]
    });
  });

  test("quản lý theo phạm vi chỉ thấy TTKD của Sale mình quản lý", async () => {
    const trend = await getDailyReportTrend({
      ability: buildAbility([
        {
          action: "daily_report.view",
          subject: "DailyReport",
          conditions: { employee_id: { $in: [String(ids.s2)] } } as any
        }
      ]),
      metric: "investment_outflow",
      granularity: "week",
      toKey: "2026-11-13",
      periods: 2
    });
    expect(trend.company_wide).toBe(false);
    expect(trend.units.map((u: any) => u.id).sort()).toEqual(
      [String(ids.cn), String(ids.hn2)].sort()
    );
    // Tuần 06/11–12/11 chứa tất toán B1 (12/11); tuần 13/11 mới bắt đầu
    expect(trend.totals.values).toEqual([60 * M, 0]);
  });

  test("quyền toàn công ty cấp từ 2 role RBAC (conditions rỗng) vẫn là toàn công ty", async () => {
    const trend = await getDailyReportTrend({
      ability: buildAbility([
        { action: "daily_report.view", subject: "DailyReport", conditions: {} as any },
        { action: "daily_report.view", subject: "DailyReport", conditions: {} as any }
      ]),
      metric: "investment_outflow",
      granularity: "week",
      toKey: "2026-11-13",
      periods: 2
    });
    expect(trend.company_wide).toBe(true);
  });

  test("chỉ tiêu không hỗ trợ xu hướng bị từ chối", async () => {
    await expect(
      getDailyReportTrend({
        ability: companyAbility(),
        metric: "compliance",
        granularity: "week",
        toKey: "2026-11-13"
      })
    ).rejects.toThrow("chưa hỗ trợ xu hướng");
  });
});

describe("chạy bù lịch sử", () => {
  test("chuỗi tái tục đã đáo hạn hết trước lần đồng bộ đầu vẫn nối đúng từng khoản", async () => {
    const appId = id();
    await AppModel.create({ _id: appId, name: "Chuỗi", code: "chain-app" });
    const [customer] = await CustomerModel.create([
      { app_id: appId, phone_number: "0911000009", external_id: "kh-chain", referred_by: ids.s1 }
    ]);
    const make = (code: string, investedAt: Date) =>
      InvestmentModel.create({
        app_id: appId,
        customer_id: customer._id,
        external_investment_id: code,
        product_name: "Tích lũy",
        amount: 60 * M,
        term_type: "month",
        term_value: 1,
        interest_rate: 5,
        invested_at: investedAt,
        maturity_at: investedAt
      });
    const c1 = await make("C1", vn("2026-08-01T09:00:00"));
    const c2 = await make("C2", vn("2026-09-01T11:00:00"));
    const c3 = await make("C3", vn("2026-10-01T11:00:00"));
    const rows = [
      // TIKLUY trả không theo thứ tự thời gian
      {
        investmentCode: "C2",
        investAmount: 60 * M,
        status: 2,
        endDate: "01/10/2026 09:00",
        formOfMaturity: "Tái tục gốc"
      },
      {
        investmentCode: "C1",
        investAmount: 60 * M,
        status: 2,
        endDate: "01/09/2026 09:00",
        formOfMaturity: "Tái tục gốc"
      },
      { investmentCode: "C3", investAmount: 60 * M, status: 0, endDate: "01/11/2026 09:00" }
    ];

    const result = await syncInvestmentClosures({
      appCode: "chain-app",
      now: syncAt,
      fetchHoldings: async () => rows
    });

    expect(result).toMatchObject({ closed: 2, renewed: 2, renewalLinks: 2 });
    const reloadById = async (doc: any) => (await InvestmentModel.findById(doc._id).lean()) as any;
    expect(String((await reloadById(c2)).renewal_of)).toBe(String(c1._id));
    expect(String((await reloadById(c3)).renewal_of)).toBe(String(c2._id));
    expect((await reloadById(c1)).renewal_of).toBeNull();
  });
});

describe("dữ liệu thật TIKLUY (đối chiếu live 13/11/2026)", () => {
  test("ngày dạng 'HH:mm DD/MM/YYYY' và hình thức chuyển sang kỳ hạn mới", () => {
    expect(parseTikluyDate("09:05 16/08/2026")).toEqual(vn("2026-08-16T09:05:00"));
    expect(parseTikluyDate("23:59 16/09/2026")).toEqual(vn("2026-09-16T23:59:00"));
    expect(isRenewalForm("Chuyển gốc và lãi sang kỳ hạn mới")).toBe(true);
    expect(isRenewalForm("Chuyển gốc sang kỳ hạn mới")).toBe(true);
    expect(isRenewalForm("Nhận lãi và gốc cuối kỳ")).toBe(false);
    expect(isRenewalForm("Nhận lãi hàng ngày")).toBe(false);
  });

  test("nhiều khoản đáo hạn cùng lúc: khoản tái tục là khoản có tiền sát gốc + lãi nhất", () => {
    const closure = mapHoldingClosure(
      { status: 2, investAmount: "1000000", endDate: "23:59 16/08/2026" },
      syncAt
    )!;
    const candidates = [
      { _id: "2tr", amount: 2_012_103, invested_at: vn("2026-08-16T00:00:00") },
      { _id: "1tr", amount: 1_006_051, invested_at: vn("2026-08-16T00:00:00") }
    ];
    expect(findRenewalTarget(closure, candidates)?._id).toBe("1tr");
  });

  test("khớp theo `id` (investmentCode chỉ là mã hiển thị VNF…), nối đúng cặp tái tục, bỏ qua ví không kỳ hạn", async () => {
    const appId = id();
    await AppModel.create({ _id: appId, name: "Thật", code: "real-app" });
    const [customer] = await CustomerModel.create([
      { app_id: appId, phone_number: "0911000077", external_id: "kh-real", referred_by: ids.s1 }
    ]);
    const make = (code: string, amount: number, investedAt: string) =>
      InvestmentModel.create({
        app_id: appId,
        customer_id: customer._id,
        external_investment_id: code,
        product_name: "LỘC VÀNG",
        amount,
        term_type: "month",
        term_value: 1,
        interest_rate: 7.5,
        invested_at: new Date(investedAt),
        maturity_at: new Date(investedAt)
      });
    const old2 = await make("d11f0824", 2_000_000, "2026-07-16T00:00:00.000Z");
    const old1 = await make("d3106437", 1_000_000, "2026-07-16T00:00:00.000Z");
    const new2 = await make("83156246", 2_012_103, "2026-08-16T00:00:00.000Z");
    const new1 = await make("f6fc63ba", 1_006_051, "2026-08-16T00:00:00.000Z");
    const roll = "Chuyển gốc và lãi sang kỳ hạn mới";
    const rows = [
      {
        id: "83156246",
        investmentCode: "VNF0000000002935",
        investAmount: "2012103.0",
        startDate: "09:05 16/08/2026",
        endDate: "23:59 16/09/2026",
        status: "1",
        formOfMaturity: roll
      },
      {
        id: "f6fc63ba",
        investmentCode: "VNF0000000002936",
        investAmount: "1006051.0",
        startDate: "09:05 16/08/2026",
        endDate: "23:59 16/09/2026",
        status: "1",
        formOfMaturity: roll
      },
      {
        id: "db142a5d",
        investmentCode: "GWV22cb60a043dd3",
        investAmount: "313832.00",
        startDate: "10:00 02/08/2026",
        endDate: null,
        status: "0",
        formOfMaturity: "Nhận lãi hàng ngày"
      },
      {
        id: "d11f0824",
        investmentCode: "VNF0000000002456",
        investAmount: "2000000",
        startDate: "09:00 16/07/2026",
        endDate: "23:59 16/08/2026",
        status: "2",
        formOfMaturity: roll
      },
      {
        id: "d3106437",
        investmentCode: "VNF0000000002455",
        investAmount: "1000000",
        startDate: "09:00 16/07/2026",
        endDate: "23:59 16/08/2026",
        status: "2",
        formOfMaturity: roll
      }
    ];

    const result = await syncInvestmentClosures({
      appCode: "real-app",
      now: syncAt,
      fetchHoldings: async () => rows
    });

    expect(result).toMatchObject({ closed: 4, renewed: 2, renewalLinks: 2, unknownCodes: 0 });
    const reloadById = async (doc: any) => (await InvestmentModel.findById(doc._id).lean()) as any;
    expect(String((await reloadById(new2)).renewal_of)).toBe(String(old2._id));
    expect(String((await reloadById(new1)).renewal_of)).toBe(String(old1._id));
    expect((await reloadById(old2)).closure).toMatchObject({
      type: "matured",
      renewed: true,
      closed_at: vn("2026-08-16T23:59:00")
    });
    expect((await reloadById(new2)).closure).toMatchObject({
      type: "early_terminated",
      principal: 2_012_103,
      closed_at: vn("2026-09-16T23:59:00")
    });
  });
});

describe("tất toán trước hạn phát hiện ở lần đồng bộ đầu", () => {
  test("không rõ ngày → không tính tiền ra theo kỳ, nhưng vẫn trừ khỏi số dư", async () => {
    const appId = id();
    await AppModel.create({ _id: appId, name: "Lần đầu", code: "first-sync-app" });
    const [customer] = await CustomerModel.create([
      { app_id: appId, phone_number: "0911000088", external_id: "kh-first", referred_by: ids.s2 }
    ]);
    const early = await InvestmentModel.create({
      app_id: appId,
      customer_id: customer._id,
      external_investment_id: "E1",
      product_name: "LỘC VÀNG",
      amount: 70 * M,
      term_type: "month",
      term_value: 12,
      interest_rate: 12,
      invested_at: vn("2026-05-22T09:00:00"),
      maturity_at: vn("2027-05-22T09:00:00"),
      kpi_attribution: await buildInvestmentAttribution(customer, null, vn("2026-05-22T09:00:00"))
    });
    const result = await syncInvestmentClosures({
      appCode: "first-sync-app",
      now: syncAt,
      fetchHoldings: async () => [
        {
          id: "E1",
          investAmount: "70000000",
          startDate: "09:00 22/05/2026",
          endDate: "23:59 22/05/2027",
          status: "1"
        }
      ]
    });
    expect(result.closed).toBe(1);
    expect(((await InvestmentModel.findById(early._id).lean()) as any).closure).toMatchObject({
      type: "early_terminated",
      date_unknown: true
    });

    const range = { from: vn("2026-11-01T00:00:00"), to: vn("2026-11-14T00:00:00") };
    expect(
      await AUTO_METRIC_SOURCES.investment_outflow({ appId: String(appId), range, saleIds: null })
    ).toEqual([]);
    expect(await AUTO_METRIC_SOURCES.aum({ appId: String(appId), range, saleIds: null })).toEqual(
      []
    );
  });
});
