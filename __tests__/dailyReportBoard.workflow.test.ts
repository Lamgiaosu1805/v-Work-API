import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AgentModel from "../src/models/AgentModel";
import AppModel from "../src/models/AppModel";
import CallLogModel from "../src/models/CallLogModel";
import CustomerModel from "../src/models/CustomerModel";
import DepartmentModel from "../src/models/DepartmentModel";
import InvestmentModel from "../src/models/InvestmentModel";
import KpiPlanModel from "../src/models/KpiPlanModel";
import UserDepartmentPositionModel from "../src/models/UserDepartmentPositionModel";
import { buildAbility } from "../src/modules/permission";
import {
  buildInvestmentAttribution,
  buildKpiCif,
  resolveSaleUnitIds
} from "../src/helpers/kpiAttribution";
import {
  getDailyReportSummary,
  getMyDailyReport,
  listDailyReportReminderAccounts,
  saveMyDailyReportPlan,
  submitMyDailyReportResult
} from "../src/workflows/daily-report-board.workflow";

// Giờ Việt Nam = UTC+7
const vn = (iso: string) => new Date(`${iso}+07:00`);
const id = () => new mongoose.Types.ObjectId();

let mongod: MongoMemoryServer;

const ids = {
  app: id(),
  khoi: id(),
  cnHn: id(),
  hn1: id(),
  hn2: id(),
  otherDept: id(),
  s1: id(),
  s2: id(),
  account1: id(),
  agent: id()
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await AppModel.create({ _id: ids.app, name: "TikLuy", code: "tikluy" });
  await DepartmentModel.create([
    {
      _id: ids.khoi,
      department_name: "Khối Chi nhánh & TTKD",
      department_code: "KHOI-CN",
      type: "division"
    },
    {
      _id: ids.cnHn,
      department_name: "Chi nhánh Hà Nội",
      department_code: "CN-HN",
      type: "division",
      parent: ids.khoi
    },
    {
      _id: ids.hn1,
      department_name: "TTKD HN1",
      department_code: "TTKD-HN1",
      type: "branch",
      parent: ids.cnHn
    },
    {
      _id: ids.hn2,
      department_name: "TTKD HN2",
      department_code: "TTKD-HN2",
      type: "branch",
      parent: ids.cnHn
    },
    {
      _id: ids.otherDept,
      department_name: "Phòng khác",
      department_code: "OTHER",
      type: "department"
    }
  ]);
  // S1 thuộc 1 phòng thường (xếp trước) + TTKD HN1 → TTKD phải được ưu tiên
  await UserDepartmentPositionModel.create([
    {
      user: ids.s1,
      department: ids.otherDept,
      position: id(),
      createdAt: vn("2026-01-01T00:00:00")
    },
    { user: ids.s1, department: ids.hn1, position: id(), createdAt: vn("2026-02-01T00:00:00") },
    { user: ids.s2, department: ids.hn2, position: id() }
  ]);
  await mongoose.connection.collection("user_infos").insertMany([
    {
      _id: ids.s1,
      full_name: "Sale Một",
      ma_nv: "NV001",
      id_account: ids.account1,
      isDeleted: false
    },
    { _id: ids.s2, full_name: "Sale Hai", ma_nv: "NV002", id_account: id(), isDeleted: false }
  ]);
  await AgentModel.create({
    _id: ids.agent,
    app_id: ids.app,
    agent_code: "DL01",
    external_id: "ext-agent",
    full_name: "Đại lý 1",
    phone_number: "0900000000",
    manager_sale_id: ids.s2
  });
  await KpiPlanModel.create({
    app_id: ids.app,
    year: 2026,
    employee_id: ids.s1,
    template_code: "TTKD",
    effective_from: "2026-11-06",
    targets: [
      { metric_code: "investment_amount", annual: 1_200_000_000 },
      { metric_code: "cif_new", annual: 24 }
    ]
  });

  // Khách: C1 của S1 (mã Sale), C2 qua đại lý của S2, C3 marketing chưa có Sale
  const today = vn("2026-11-12T10:00:00");
  const [c1, c2, c3] = await CustomerModel.create([
    {
      app_id: ids.app,
      phone_number: "0911000001",
      referred_by: ids.s1,
      registeredAt: today,
      kpi_cif: await buildKpiCif({ channel: "sale_ref", saleId: ids.s1, at: today })
    },
    {
      app_id: ids.app,
      phone_number: "0911000002",
      agent_id: ids.agent,
      registeredAt: today,
      kpi_cif: await buildKpiCif({ channel: "agent", agentId: ids.agent, at: today })
    },
    { app_id: ids.app, phone_number: "0911000003", registeredAt: today }
  ]);

  const investment = async (customer: any, amount: number, investedAt: Date, extId: string) =>
    InvestmentModel.create({
      app_id: ids.app,
      customer_id: customer._id,
      external_investment_id: extId,
      product_name: "Tích lũy",
      amount,
      term_type: "week",
      term_value: 7,
      interest_rate: 5,
      invested_at: investedAt,
      maturity_at: vn("2027-01-01T00:00:00"),
      kpi_attribution: await buildInvestmentAttribution(customer, null, investedAt)
    });
  await investment(c1, 20_000_000, vn("2026-11-03T09:00:00"), "inv-1");
  await investment(c1, 50_000_000, vn("2026-11-12T11:00:00"), "inv-2");
  await investment(c2, 30_000_000, vn("2026-11-12T11:30:00"), "inv-3");
  await investment(c3, 10_000_000, vn("2026-11-12T12:00:00"), "inv-4");

  const call = (answerSec: number, n: number) =>
    CallLogModel.create({
      transaction_id: `t-${n}`,
      call_uuid: `c-${n}`,
      direction: "outbound",
      phone_number: "0911000001",
      sale_id: ids.s1,
      answer_sec: answerSec,
      time_start_call: vn("2026-11-12T14:00:00")
    });
  await call(30, 1);
  await call(45, 2);
  await call(10, 3); // dưới 20 giây — không tính
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("ghi nhận KPI", () => {
  test("TTKD của Sale ưu tiên phòng ban loại TTKD", async () => {
    const units = await resolveSaleUnitIds([ids.s1, ids.s2]);
    expect(String(units.get(String(ids.s1)))).toBe(String(ids.hn1));
    expect(String(units.get(String(ids.s2)))).toBe(String(ids.hn2));
  });

  test("khách đại lý ghi nhận cho Sale phụ trách đại lý; khách không Sale là chưa phân bổ", async () => {
    const attribution = await buildInvestmentAttribution({
      referred_by: null,
      agent_id: ids.agent
    });
    expect(attribution.channel).toBe("agent");
    expect(String(attribution.sale_id)).toBe(String(ids.s2));
    expect(String(attribution.department_id)).toBe(String(ids.hn2));
    const none = await buildInvestmentAttribution({ referred_by: null, agent_id: null });
    expect(none).toMatchObject({ sale_id: null, department_id: null, channel: "unassigned" });
  });
});

describe("báo cáo ngày", () => {
  test("Sale nộp kế hoạch và kết quả, xem được số tự động + tiến độ", async () => {
    await saveMyDailyReportPlan({
      employeeId: String(ids.s1),
      now: vn("2026-11-12T08:00:00"),
      body: { targets: [{ metric_code: "investment_amount", value: 5_000_000 }], note: "Gọi 40 KH" }
    });
    await submitMyDailyReportResult({
      employeeId: String(ids.s1),
      now: vn("2026-11-12T17:00:00"),
      body: {
        values: [{ metric_code: "roadshow", value: 1 }],
        achievements: "Roadshow chung cư A",
        blockers: null,
        proposals: null
      }
    });

    const view = await getMyDailyReport({
      employeeId: String(ids.s1),
      dateKey: "2026-11-12",
      now: vn("2026-11-12T18:00:00")
    });
    const metric = (code: string) => view.metrics.find((m: any) => m.code === code) as any;

    expect(view.participant).toBe(true);
    expect(view.unit).toEqual({ id: String(ids.hn1), name: "TTKD HN1" });
    expect(view.plan_status).toBe("on_time");
    expect(view.result_status).toBe("on_time");
    expect(view.can_submit_result).toBe(false); // đã nộp và đã qua 17:30

    expect(metric("investment_amount")).toMatchObject({
      day: 50_000_000,
      mtd: 70_000_000,
      ytd: 70_000_000,
      plan_day: 5_000_000,
      plan_month: 100_000_000,
      plan_year: 1_200_000_000,
      remaining_year: 1_130_000_000
    });
    expect(metric("cif_new")).toMatchObject({ day: 1, plan_year: 24 });
    expect(metric("telesale_call")).toMatchObject({ day: 2 });
    expect(metric("roadshow")).toMatchObject({ day: 1, mtd: 1 });
    // Phải báo cáo 06,07,09,10,11,12/11 (bỏ Chủ nhật 08/11) — chỉ 12/11 đúng hạn
    expect(metric("compliance")).toMatchObject({
      day: 1,
      mtd: 1,
      base: { day: 1, mtd: 6, ytd: 6 }
    });
  });

  test("lãnh đạo toàn công ty: cộng dồn theo cây Khối → Chi nhánh → TTKD + dòng chưa phân bổ", async () => {
    const summary = await getDailyReportSummary({
      ability: buildAbility([{ action: "daily_report.view", subject: "DailyReport" }]),
      dateKey: "2026-11-12",
      now: vn("2026-11-12T18:00:00")
    });
    const unit = (unitId: string) => summary.units.find((u: any) => u.id === unitId) as any;

    expect(summary.company_wide).toBe(true);
    expect(unit(String(ids.hn1)).metrics.investment_amount.day).toBe(50_000_000);
    expect(unit(String(ids.hn2)).metrics.investment_amount.day).toBe(30_000_000);
    expect(unit(String(ids.cnHn)).metrics.investment_amount.day).toBe(80_000_000);
    expect(unit(String(ids.cnHn)).parent_id).toBe(String(ids.khoi));
    expect(unit(String(ids.khoi)).metrics.cif_new.day).toBe(2);
    expect(unit("__unassigned__").metrics).toMatchObject({
      investment_amount: { day: 10_000_000 },
      cif_new: { day: 1 }
    });
    expect(summary.totals.metrics.investment_amount.day).toBe(90_000_000);
    expect(unit(String(ids.hn1)).submission).toMatchObject({ required: 1, result_on_time: 1 });
    const s1Row = summary.employees.find((e: any) => e.ma_nv === "NV001") as any;
    expect(s1Row.report.result.achievements).toBe("Roadshow chung cư A");
    expect(s1Row.result_status).toBe("on_time");
  });

  test("quản lý theo phạm vi: chỉ thấy Sale mình quản lý, không có dòng chưa phân bổ", async () => {
    const summary = await getDailyReportSummary({
      ability: buildAbility([
        {
          action: "daily_report.view",
          subject: "DailyReport",
          conditions: { employee_id: { $in: [String(ids.s2)] } } as any
        }
      ]),
      dateKey: "2026-11-12",
      now: vn("2026-11-12T18:00:00")
    });
    expect(summary.company_wide).toBe(false);
    expect(summary.employees.map((e: any) => e.ma_nv)).toEqual(["NV002"]);
    expect(summary.units.find((u: any) => u.id === "__unassigned__")).toBeUndefined();
    expect(summary.totals.metrics.investment_amount.day).toBe(30_000_000);
  });

  test("nhắc nộp: chỉ người có kế hoạch KPI, chưa nộp phần đó", async () => {
    expect(
      await listDailyReportReminderAccounts({ kind: "plan", now: vn("2026-11-13T08:45:00") })
    ).toEqual([String(ids.account1)]);
    expect(
      await listDailyReportReminderAccounts({ kind: "result", now: vn("2026-11-12T16:30:00") })
    ).toEqual([]);
  });
});
