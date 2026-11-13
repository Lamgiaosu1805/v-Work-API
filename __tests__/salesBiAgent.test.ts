import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import DepartmentModel from "../src/models/DepartmentModel";
import InvestmentModel from "../src/models/InvestmentModel";
import KpiPlanModel from "../src/models/KpiPlanModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildInvestmentAttribution } from "../src/helpers/kpiAttribution";
import { SALES_BI_TOOLS } from "../src/workflows/agents/sales-bi.tools";
import { createSalesBiAgent } from "../src/workflows/agents/sales-bi.agent";

// Công cụ của agent "Trợ lý kinh doanh": đúng số của bảng tổng hợp, đúng phạm vi quyền của người hỏi, tên đơn vị không
// bị ghi đè, kiểm tra tham số. Quyền giả lập qua loadRules (không cần Redis).
const ids = {
  app: new mongoose.Types.ObjectId(),
  khoi: new mongoose.Types.ObjectId(),
  hn1: new mongoose.Types.ObjectId(),
  hp: new mongoose.Types.ObjectId(),
  s1: new mongoose.Types.ObjectId(),
  s2: new mongoose.Types.ObjectId(),
  boss: new mongoose.Types.ObjectId(),
  manager: new mongoose.Types.ObjectId()
};

jest.mock("../src/core/authorization/require-permission.middleware", () => ({
  loadRules: async (employeeId: string) =>
    employeeId === String(ids.manager)
      ? [
          {
            action: "daily_report.view",
            subject: "DailyReport",
            conditions: { employee_id: { $in: [String(ids.s2)] } }
          }
        ]
      : [{ action: "daily_report.view", subject: "DailyReport", conditions: {} }]
}));

const vn = (iso: string) => new Date(`${iso}+07:00`);
const M = 1_000_000;
const now = vn("2026-11-13T15:00:00");
let mongod: MongoMemoryServer;
const tool = (name: string) => SALES_BI_TOOLS.find((t) => t.name === name)!;
const ctxOf = (employee: mongoose.Types.ObjectId) => ({
  accountId: "acc",
  employeeId: String(employee),
  now
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await AppModel.create({ _id: ids.app, name: "TikLuy", code: "tikluy" });
  await DepartmentModel.create([
    {
      _id: ids.khoi,
      department_name: "Khối Kinh Doanh",
      department_code: "K-KD",
      type: "division"
    },
    {
      _id: ids.hn1,
      department_name: "TTKD Hà Nội 1",
      department_code: "TTKD-HN",
      type: "branch",
      parent: ids.khoi
    },
    {
      _id: ids.hp,
      department_name: "TTKD Hải Phòng",
      department_code: "TTKD-HP",
      type: "branch",
      parent: ids.khoi
    }
  ]);
  await UserDepartmentPositionModel.create([
    { user: ids.s1, department: ids.hn1, position: new mongoose.Types.ObjectId() },
    { user: ids.s2, department: ids.hp, position: new mongoose.Types.ObjectId() }
  ]);
  await mongoose.connection.collection("user_infos").insertMany([
    {
      _id: ids.s1,
      full_name: "Sale Một",
      ma_nv: "NV001",
      id_account: new mongoose.Types.ObjectId(),
      isDeleted: false
    },
    {
      _id: ids.s2,
      full_name: "Sale Hai",
      ma_nv: "NV002",
      id_account: new mongoose.Types.ObjectId(),
      isDeleted: false
    },
    {
      _id: ids.boss,
      full_name: "Lãnh Đạo",
      ma_nv: "BLD",
      id_account: new mongoose.Types.ObjectId(),
      isDeleted: false
    }
  ]);
  await KpiPlanModel.create({
    app_id: ids.app,
    year: 2026,
    employee_id: ids.s1,
    template_code: "TTKD",
    effective_from: "2026-11-02",
    targets: [{ metric_code: "investment_amount", annual: 1_200 * M }]
  });
  const [c1, c2] = await CustomerModel.create([
    { app_id: ids.app, phone_number: "0911000001", referred_by: ids.s1 },
    { app_id: ids.app, phone_number: "0911000002", referred_by: ids.s2 }
  ]);
  const invest = async (customer: any, code: string, amount: number, at: Date) =>
    InvestmentModel.create({
      app_id: ids.app,
      customer_id: customer._id,
      external_investment_id: code,
      product_name: "Tích lũy",
      amount,
      term_type: "month",
      term_value: 3,
      interest_rate: 6,
      invested_at: at,
      maturity_at: vn("2027-03-01T00:00:00"),
      kpi_attribution: await buildInvestmentAttribution(customer, null, at)
    });
  await invest(c1, "A", 50 * M, vn("2026-11-05T09:00:00"));
  await invest(c2, "B", 80 * M, vn("2026-11-10T09:00:00"));
  await invest(c2, "C", 20 * M, vn("2026-10-20T09:00:00"));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("công cụ Trợ lý kinh doanh", () => {
  test("tổng quan tháng: tiền theo triệu đồng, có kế hoạch khi đã giao", async () => {
    const result: any = await tool("get_overview").run(
      { date: null, period: "mtd" },
      ctxOf(ids.boss)
    );
    expect(result.as_of).toBe("2026-11-13");
    expect(result.company_wide).toBe(true);
    expect(result.metrics.investment_amount).toMatchObject({
      value: 130,
      plan: 100,
      value_unit: "triệu đồng"
    });
    expect(result.metrics.net_growth.value).toBe(130);
  });

  test("so sánh TTKD: xếp hạng đúng, giữ tên đơn vị, có bình quân / Sale", async () => {
    const result: any = await tool("compare_units").run(
      { date: null, period: "ytd", metric: "investment_amount", parent: null },
      ctxOf(ids.boss)
    );
    expect(result.rows.map((r: any) => [r.rank, r.unit, r.value])).toEqual([
      [1, "TTKD Hải Phòng", 100],
      [2, "TTKD Hà Nội 1", 50]
    ]);
    expect(result.rows[0]).toMatchObject({
      path: "Khối Kinh Doanh › TTKD Hải Phòng",
      value_unit: "triệu đồng"
    });
  });

  test("so sánh các đơn vị trực thuộc một khối theo tên gần đúng (không dấu)", async () => {
    const result: any = await tool("compare_units").run(
      { date: null, period: "mtd", metric: "investment_amount", parent: "khoi kinh doanh" },
      ctxOf(ids.boss)
    );
    expect(result.scope).toBe("trực thuộc Khối Kinh Doanh");
    expect(result.rows).toHaveLength(2);
  });

  test("danh sách Sale theo đơn vị, thấp nhất trước", async () => {
    const result: any = await tool("get_people").run(
      {
        date: null,
        period: "mtd",
        metric: "investment_amount",
        unit: "Khối Kinh Doanh",
        name: null,
        order: "asc",
        limit: null
      },
      ctxOf(ids.boss)
    );
    expect(result.rows.map((r: any) => [r.name, r.unit, r.value])).toEqual([
      ["Sale Một", "TTKD Hà Nội 1", 50],
      ["Sale Hai", "TTKD Hải Phòng", 80]
    ]);
  });

  test("xu hướng theo tháng cho từng đơn vị", async () => {
    const result: any = await tool("get_trend").run(
      {
        metric: "investment_amount",
        granularity: "month",
        periods: 2,
        to: null,
        units: ["Hải Phòng"]
      },
      ctxOf(ids.boss)
    );
    expect(result.buckets).toEqual(["10/2026", "11/2026"]);
    expect(result.series).toEqual([{ unit: "TTKD Hải Phòng", values: [20, 80] }]);
  });

  test("quản lý chỉ thấy Sale mình quản lý", async () => {
    const result: any = await tool("compare_units").run(
      { date: null, period: "ytd", metric: "investment_amount", parent: null },
      ctxOf(ids.manager)
    );
    expect(result.rows.map((r: any) => r.unit)).toEqual(["TTKD Hải Phòng"]);
    const overview: any = await tool("get_overview").run(
      { date: null, period: "ytd" },
      ctxOf(ids.manager)
    );
    expect(overview.company_wide).toBe(false);
    expect(overview.metrics.investment_amount.value).toBe(100);
  });

  test("tham số sai bị từ chối rõ ràng", async () => {
    await expect(
      tool("compare_units").run(
        { date: null, period: "mtd", metric: "salary", parent: null },
        ctxOf(ids.boss)
      )
    ).rejects.toThrow("không hỗ trợ");
    await expect(
      tool("get_overview").run({ date: "2026-12-01", period: "mtd" }, ctxOf(ids.boss))
    ).rejects.toThrow("tương lai");
    await expect(
      tool("get_people").run(
        {
          date: null,
          period: "mtd",
          metric: "investment_amount",
          unit: "TTKD Đà Nẵng",
          name: null,
          order: "desc",
          limit: 5
        },
        ctxOf(ids.boss)
      )
    ).rejects.toThrow("Không tìm thấy đơn vị");
  });

  test("tình hình nộp báo cáo: chỉ tính Sale đã giao kế hoạch", async () => {
    const result: any = await tool("get_submission_status").run({ date: null }, ctxOf(ids.boss));
    expect(result.totals.required).toBe(1);
    expect(result.plan_not_submitted.map((p: any) => p.name)).toEqual(["Sale Một"]);
  });

  test("định nghĩa agent: công cụ strict hợp lệ, system prompt không chứa ngày giờ", () => {
    const agent = createSalesBiAgent();
    expect(agent.permission).toEqual({ action: "agent.sales_bi.use", subject: "AgentSalesBi" });
    expect(agent.systemPrompt).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    agent.tools.forEach((t) => {
      const schema = t.inputSchema as any;
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    });
  });
});
