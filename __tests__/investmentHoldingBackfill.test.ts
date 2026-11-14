import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import DepartmentModel from "../src/models/DepartmentModel";
import InvestmentModel from "../src/models/InvestmentModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildInvestmentAttribution } from "../src/helpers/kpiAttribution";
import {
  isCounterCode,
  mapHoldingInvestment,
  parseHoldingTerm
} from "../src/workflows/investment-closure/holding-mapper";
import { syncInvestmentClosures } from "../src/workflows/investment-closure-sync.workflow";
import { AUTO_METRIC_SOURCES } from "../src/workflows/daily-report/auto-metric-sources";

// Tạo bù khoản TIKLUY có mà vWork thiếu (TIKLUY không đẩy sang) — dựng theo các dòng thật đối chiếu live 13/11/2026:
// chuỗi VNFM… mở tại quầy (đáo hạn tái tục → khoản mới tất toán trước hạn), khoản tái tục tự động kỳ hạn ngắn,
// ví không kỳ hạn. Khoản tạo bù không có hoa hồng, khoản sinh ra do tái tục không tính tiền vào.

const vn = (iso: string) => new Date(`${iso}+07:00`);
const id = () => new mongoose.Types.ObjectId();
const M = 1_000_000;
const syncAt = vn("2026-11-13T01:30:00");
const ids = { app: id(), cn: id(), hn1: id(), s1: id() };
const RENEW = "Chuyển gốc và lãi sang kỳ hạn mới";

const lv = (row: Record<string, unknown>) => ({
  investmentHoldingProduct: "LỘC VÀNG",
  interestRate: "9.50",
  totalProfit: "0",
  formOfMaturity: "Nhận lãi và gốc cuối kỳ",
  ...row
});

const holdings: Record<string, any[]> = {
  "kh-bf": [
    // Đã có trên vWork: E1 tất toán (tái tục) từ lần đồng bộ trước, O1 đang mở
    lv({
      id: "uuid-e1",
      investmentCode: "VNF0000000003358",
      investAmount: "1000000",
      interestRatePeriod: "1 tháng",
      startDate: "09:05 10/09/2026",
      endDate: "23:59 10/10/2026",
      status: "2",
      formOfMaturity: RENEW
    }),
    lv({
      id: "uuid-o1",
      investmentCode: "VNF0000000004000",
      investAmount: "20000000",
      interestRatePeriod: "3 tháng",
      startDate: "09:00 01/10/2026",
      endDate: "23:59 01/01/2027",
      status: "0"
    }),
    // Thiếu trên vWork:
    // M6 — TIKLUY tự tái tục E1 (gốc + lãi), đang mở
    lv({
      id: "uuid-m6",
      investmentCode: "VNF0000000003859",
      investAmount: "1010000",
      interestRatePeriod: "1 tháng",
      startDate: "09:05 10/10/2026",
      endDate: "23:59 10/11/2026",
      status: "0",
      formOfMaturity: RENEW
    }),
    // M1 → M2: mở tại quầy, đáo hạn tái tục sang M2, M2 tất toán trước hạn (TIKLUY không có ngày thật)
    lv({
      id: "uuid-m1",
      investmentCode: "VNFM000000000005",
      investAmount: "50000000",
      interestRatePeriod: "3 tháng",
      startDate: "17:50 24/06/2026",
      endDate: "23:59 24/09/2026",
      status: "2",
      formOfMaturity: RENEW
    }),
    lv({
      id: "uuid-m2",
      investmentCode: "VNFM000000000040",
      investAmount: "51137397.0",
      interestRatePeriod: "3 tháng",
      startDate: "09:10 24/09/2026",
      endDate: "23:59 24/12/2026",
      status: "1",
      formOfMaturity: RENEW
    }),
    // M3 — mở tại quầy, đáo hạn rút về
    lv({
      id: "uuid-m3",
      investmentCode: "VNFM000000000006",
      investAmount: "300058561",
      interestRatePeriod: "3 tháng",
      startDate: "09:00 30/06/2026",
      endDate: "23:59 30/09/2026",
      status: "2"
    }),
    // M4 — kỳ hạn 7 ngày đang mở
    lv({
      id: "uuid-m4",
      investmentCode: "VNF0000000004600",
      investAmount: "5000000",
      interestRatePeriod: "7 ngày",
      startDate: "09:00 06/11/2026",
      endDate: "23:59 13/11/2026",
      status: "0"
    }),
    // M5 — mới bắt đầu hôm qua: chờ TIKLUY đẩy sang (có hoa hồng), không tạo bù
    lv({
      id: "uuid-m5",
      investmentCode: "VNF0000000004700",
      investAmount: "2000000",
      interestRatePeriod: "1 tháng",
      startDate: "09:00 12/11/2026",
      endDate: "23:59 12/12/2026",
      status: "0"
    }),
    // Ví không kỳ hạn — không theo dõi như khoản có kỳ hạn
    {
      id: "uuid-w1",
      investmentCode: "GWV2abcdef",
      investmentHoldingProduct: "VÍ VÀNG",
      investAmount: "3000000",
      interestRatePeriod: "Không kỳ hạn",
      startDate: "09:00 01/09/2026",
      endDate: null,
      status: "0"
    }
  ],
  // Khách không còn khoản mở trên vWork → hằng đêm không hỏi, chỉ chạy bù --all-customers mới thấy
  "kh-c": [
    lv({
      id: "uuid-c1",
      investmentCode: "VNF0000000005000",
      investAmount: "10000000",
      interestRatePeriod: "6 tháng",
      startDate: "10:00 01/10/2026",
      endDate: "23:59 01/04/2027",
      status: "0"
    })
  ]
};
const fetchHoldings = async (externalId: string) => holdings[externalId] ?? [];

let mongod: MongoMemoryServer;
let customerBf: any;
let customerC: any;
const byExternal = async (externalId: string) =>
  (await InvestmentModel.findOne({ external_investment_id: externalId }).lean()) as any;
const metric = async (code: string, from: string, to: string) =>
  (
    await AUTO_METRIC_SOURCES[code]({
      appId: String(ids.app),
      range: { from: vn(`${from}T00:00:00`), to: vn(`${to}T00:00:00`) },
      saleIds: null
    })
  ).reduce((sum, row) => sum + row.value, 0);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await AppModel.create({ _id: ids.app, name: "TikLuy", code: "tikluy" });
  await DepartmentModel.create([
    { _id: ids.cn, department_name: "Khối Kinh Doanh", department_code: "K-KD", type: "division" },
    {
      _id: ids.hn1,
      department_name: "TTKD Hải Phòng",
      department_code: "TTKD-HP",
      type: "branch",
      parent: ids.cn
    }
  ]);
  await UserDepartmentPositionModel.create({ user: ids.s1, department: ids.hn1, position: id() });
  await mongoose.connection
    .collection("user_infos")
    .insertOne({ _id: ids.s1, full_name: "Sale Một", ma_nv: "036", isDeleted: false });
  [customerBf, customerC] = await CustomerModel.create([
    { app_id: ids.app, phone_number: "0911000001", external_id: "kh-bf", referred_by: ids.s1 },
    { app_id: ids.app, phone_number: "0911000002", external_id: "kh-c", referred_by: ids.s1 }
  ]);
  const base = {
    app_id: ids.app,
    customer_id: customerBf._id,
    product_name: "LỘC VÀNG",
    term_type: "month",
    interest_rate: 9.5
  };
  await InvestmentModel.create([
    {
      ...base,
      external_investment_id: "uuid-e1",
      amount: 1 * M,
      term_value: 1,
      invested_at: vn("2026-09-10T09:05:00"),
      maturity_at: vn("2026-10-10T23:59:00"),
      kpi_attribution: await buildInvestmentAttribution(
        customerBf,
        null,
        vn("2026-09-10T09:05:00")
      ),
      closure: {
        type: "matured",
        closed_at: vn("2026-10-10T23:59:00"),
        principal: 1 * M,
        form_of_maturity: RENEW,
        renewed: true,
        synced_at: vn("2026-11-01T01:30:00")
      },
      holding_synced_at: vn("2026-11-01T01:30:00")
    },
    {
      ...base,
      external_investment_id: "uuid-o1",
      amount: 20 * M,
      term_value: 3,
      invested_at: vn("2026-10-01T09:00:00"),
      maturity_at: vn("2027-01-01T23:59:00"),
      kpi_attribution: await buildInvestmentAttribution(
        customerBf,
        null,
        vn("2026-10-01T09:00:00")
      ),
      holding_synced_at: vn("2026-11-12T01:30:00")
    }
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("đọc dòng danh mục TIKLUY để tạo bù", () => {
  test("kỳ hạn: tháng, ngày (week lưu số ngày), tuần; không kỳ hạn → null", () => {
    expect(parseHoldingTerm("3 tháng")).toEqual({ term_type: "month", term_value: 3 });
    expect(parseHoldingTerm("7 ngày")).toEqual({ term_type: "week", term_value: 7 });
    expect(parseHoldingTerm("2 tuần")).toEqual({ term_type: "week", term_value: 14 });
    expect(parseHoldingTerm("Không kỳ hạn")).toBeNull();
    expect(parseHoldingTerm(null)).toBeNull();
  });

  test("dòng đủ dữ liệu → khoản đầu tư; ví không kỳ hạn / thiếu ngày → null", () => {
    expect(mapHoldingInvestment(holdings["kh-bf"][4])).toEqual({
      external_investment_id: "uuid-m2",
      investment_code: "VNFM000000000040",
      product_name: "LỘC VÀNG",
      amount: 51_137_397,
      term_type: "month",
      term_value: 3,
      interest_rate: 9.5,
      invested_at: vn("2026-09-24T09:10:00"),
      maturity_at: vn("2026-12-24T23:59:00"),
      status: "early_terminated"
    });
    expect(mapHoldingInvestment(holdings["kh-bf"][8])).toBeNull();
    expect(
      mapHoldingInvestment(lv({ id: "x", investAmount: "1", interestRatePeriod: "1 tháng" }))
    ).toBeNull();
  });

  test("mã VNFM… là khoản mở tại quầy", () => {
    expect(isCounterCode("VNFM000000000005")).toBe(true);
    expect(isCounterCode("VNFMHP00000001")).toBe(true);
    expect(isCounterCode("VNF0000000003358")).toBe(false);
    expect(isCounterCode(null)).toBe(false);
  });
});

describe("đồng bộ TIKLUY tạo bù khoản thiếu", () => {
  test("tắt tạo bù / chạy thử: không ghi gì", async () => {
    const off = await syncInvestmentClosures({
      appCode: "tikluy",
      now: syncAt,
      dryRun: true,
      backfillMissing: false,
      fetchHoldings
    });
    expect(off.backfilled).toBe(0);

    const dry = await syncInvestmentClosures({
      appCode: "tikluy",
      now: syncAt,
      dryRun: true,
      fetchHoldings
    });
    expect(dry).toMatchObject({
      customers: 1,
      backfilled: 5,
      backfillRenewals: 2,
      skippedNoTerm: 1,
      skippedRecent: 1
    });
    expect(await InvestmentModel.countDocuments()).toBe(2);
  });

  test("tạo bù đủ thông tin, không hoa hồng, nối khoản tái tục, ghi tất toán ngay trong lượt", async () => {
    const result = await syncInvestmentClosures({ appCode: "tikluy", now: syncAt, fetchHoldings });
    expect(result).toMatchObject({
      customers: 1,
      synced: 1,
      backfilled: 5,
      backfillRenewals: 2,
      skippedNoTerm: 1,
      skippedRecent: 1,
      closed: 3,
      renewed: 1,
      renewalLinks: 0,
      unknownCodes: 0,
      errors: []
    });
    expect(result.backfillRows.map((r) => [r.code, r.renewal, r.counter]).sort()).toEqual([
      ["VNF0000000003859", true, false],
      ["VNF0000000004600", false, false],
      ["VNFM000000000005", false, true],
      ["VNFM000000000006", false, true],
      ["VNFM000000000040", true, true]
    ]);

    const [e1, m1, m2, m3, m4, m6] = await Promise.all(
      ["uuid-e1", "uuid-m1", "uuid-m2", "uuid-m3", "uuid-m4", "uuid-m6"].map(byExternal)
    );
    expect(await byExternal("uuid-m5")).toBeNull();
    expect(await byExternal("uuid-w1")).toBeNull();

    [m1, m2, m3, m4, m6].forEach((doc) => {
      expect(doc.source).toBe("holding_sync");
      expect(doc.commission).toMatchObject({ status: "none", sale_id: null, net_amount: 0 });
      expect(String(doc.kpi_attribution.sale_id)).toBe(String(ids.s1));
      expect(String(doc.kpi_attribution.department_id)).toBe(String(ids.hn1));
      expect(doc.kpi_attribution.attributed_at).toEqual(doc.invested_at);
    });
    expect(m1).toMatchObject({
      investment_code: "VNFM000000000005",
      product_name: "LỘC VÀNG",
      amount: 50 * M,
      term_type: "month",
      term_value: 3,
      interest_rate: 9.5,
      status: "matured"
    });
    expect(m4).toMatchObject({ term_type: "week", term_value: 7, status: "active", closure: null });
    expect(m4.holding_synced_at).toEqual(syncAt);

    // Tái tục: M2 sinh ra từ M1 (cùng lượt), M6 sinh ra từ E1 (đã tất toán từ lượt trước)
    expect(String(m2.renewal_of)).toBe(String(m1._id));
    expect(String(m6.renewal_of)).toBe(String(e1._id));
    expect(m1.renewal_of).toBeNull();

    // Tất toán ghi ngay: M1 đáo hạn tái tục, M2 trước hạn chưa rõ ngày, M3 đáo hạn rút về
    expect(m1.closure).toMatchObject({ type: "matured", renewed: true, principal: 50 * M });
    expect(m2.closure).toMatchObject({ type: "early_terminated", date_unknown: true });
    expect(m3.closure).toMatchObject({
      type: "matured",
      renewed: false,
      closed_at: vn("2026-09-30T23:59:00"),
      principal: 300_058_561
    });
    // Khoản có sẵn được ghi mã hiển thị
    expect((await byExternal("uuid-o1")).investment_code).toBe("VNF0000000004000");
  });

  test("tiền vào / tiền ra / số dư sau khi tạo bù", async () => {
    // Tháng 6: M1 + M3 (tạo bù); tháng 9: chỉ E1 — M2 là tái tục; tháng 10: chỉ O1 — M6 là tái tục
    expect(await metric("investment_amount", "2026-06-01", "2026-07-01")).toBe(350_058_561);
    expect(await metric("investment_amount", "2026-09-01", "2026-10-01")).toBe(1 * M);
    expect(await metric("investment_amount", "2026-10-01", "2026-11-01")).toBe(20 * M);
    expect(await metric("investment_amount", "2026-11-01", "2026-11-14")).toBe(5 * M);
    // Tiền ra tháng 9: M3 rút về; M1 tái tục không tính. M2 trước hạn chưa rõ ngày → không vào kỳ nào
    expect(await metric("investment_outflow", "2026-09-01", "2026-10-01")).toBe(300_058_561);
    expect(await metric("investment_outflow", "2026-11-01", "2026-11-14")).toBe(0);
    // Số dư 13/11: O1 + M6 + M4
    expect(await metric("aum", "2026-11-13", "2026-11-14")).toBe(26_010_000);
  });

  test("chạy lại không tạo trùng, không nối lại", async () => {
    const result = await syncInvestmentClosures({ appCode: "tikluy", now: syncAt, fetchHoldings });
    expect(result).toMatchObject({ backfilled: 0, closed: 0, renewalLinks: 0, unknownCodes: 0 });
    expect(await InvestmentModel.countDocuments({ customer_id: customerBf._id })).toBe(7);
  });

  test("hằng đêm bỏ qua khách không còn khoản mở; chạy bù --all-customers thì tạo", async () => {
    await syncInvestmentClosures({ appCode: "tikluy", now: syncAt, fetchHoldings });
    expect(await InvestmentModel.countDocuments({ customer_id: customerC._id })).toBe(0);

    const result = await syncInvestmentClosures({
      appCode: "tikluy",
      now: syncAt,
      fetchHoldings,
      allCustomers: true
    });
    expect(result).toMatchObject({ customers: 2, backfilled: 1 });
    expect(await byExternal("uuid-c1")).toMatchObject({
      customer_id: customerC._id,
      amount: 10 * M,
      term_value: 6,
      source: "holding_sync"
    });
  });

  test("TIKLUY vừa đẩy khoản sang trong lúc ghi (trùng mã) → bỏ dòng đó, vẫn tạo các dòng khác", async () => {
    const row = (code: string, externalId: string) =>
      lv({
        id: externalId,
        investmentCode: code,
        investAmount: "7000000",
        interestRatePeriod: "1 tháng",
        startDate: "09:00 01/11/2026",
        endDate: "23:59 01/12/2026",
        status: "0"
      });
    const original = InvestmentModel.insertMany.bind(InvestmentModel);
    const spy = jest.spyOn(InvestmentModel, "insertMany").mockImplementation((async (
      docs: any,
      options: any
    ) => {
      // TIKLUY đẩy "uuid-race" qua /investments/upsert ngay trước khi vWork ghi
      await InvestmentModel.collection.insertOne({
        app_id: ids.app,
        customer_id: customerBf._id,
        external_investment_id: "uuid-race",
        amount: 7 * M,
        isDeleted: false
      });
      return original(docs, options);
    }) as any);
    try {
      const result = await syncInvestmentClosures({
        appCode: "tikluy",
        now: syncAt,
        fetchHoldings: async (externalId) =>
          externalId === "kh-bf"
            ? [row("VNF0000000006000", "uuid-race"), row("VNF0000000006001", "uuid-ok")]
            : []
      });
      expect(result.errors).toEqual([]);
      expect(result.backfilled).toBe(1);
      expect(result.backfillRows.map((r) => r.code)).toEqual(["VNF0000000006001"]);
    } finally {
      spy.mockRestore();
    }
    expect(await InvestmentModel.countDocuments({ external_investment_id: "uuid-race" })).toBe(1);
    expect((await byExternal("uuid-ok")).source).toBe("holding_sync");
  });
});
