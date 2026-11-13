import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import InvestmentModel from "../src/models/InvestmentModel";

// Dashboard CRM: "Khách đang đầu tư" + AUM là ảnh chụp cuối kỳ, cùng định nghĩa "Số dư đang đầu tư"
// của Bảng điều hành — trừ khoản đã tất toán (đồng bộ TIKLUY) dù trạng thái vẫn là active.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DashboardController = require("../src/controllers/DashboardController");

const vn = (iso: string) => new Date(`${iso}+07:00`);
const M = 1_000_000;
let mongod: MongoMemoryServer;

const callKeyMetrics = async (query: Record<string, string>) => {
  let body: any;
  const res: any = {
    status: () => res,
    json: (data: any) => {
      body = data;
      return res;
    }
  };
  await DashboardController.getKeyMetrics({ query, account: { role: "admin" } }, res);
  return body.data.metrics;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = await AppModel.create({ name: "TikLuy", code: "tikluy", is_active: true });
  const [c1, c2, c3] = await CustomerModel.create([
    { app_id: app._id, phone_number: "0911000001" },
    { app_id: app._id, phone_number: "0911000002" },
    { app_id: app._id, phone_number: "0911000003" }
  ]);
  const base = {
    app_id: app._id,
    product_name: "Tích lũy",
    term_type: "month",
    term_value: 3,
    interest_rate: 6,
    maturity_at: vn("2027-01-01T00:00:00")
  };
  await InvestmentModel.create([
    // Còn hiệu lực
    {
      ...base,
      customer_id: c1._id,
      external_investment_id: "A",
      amount: 100 * M,
      invested_at: vn("2026-09-01T09:00:00")
    },
    // Trạng thái vẫn active nhưng đồng bộ TIKLUY đã ghi tất toán 10/11 → hết hiệu lực từ 10/11
    {
      ...base,
      customer_id: c2._id,
      external_investment_id: "B",
      amount: 50 * M,
      invested_at: vn("2026-08-01T09:00:00"),
      closure: {
        type: "matured",
        closed_at: vn("2026-11-10T23:59:00"),
        principal: 50 * M,
        synced_at: vn("2026-11-13T01:30:00")
      }
    },
    // TIKLUY đã đẩy trạng thái đáo hạn (chưa có closure) → không tính
    {
      ...base,
      customer_id: c3._id,
      external_investment_id: "C",
      amount: 30 * M,
      invested_at: vn("2026-07-01T09:00:00"),
      status: "matured"
    },
    // Bị huỷ → không tính
    {
      ...base,
      customer_id: c3._id,
      external_investment_id: "D",
      amount: 20 * M,
      invested_at: vn("2026-10-01T09:00:00"),
      status: "cancelled"
    }
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Dashboard CRM — AUM và khách đang đầu tư", () => {
  test("cuối tháng 11: chỉ khoản còn hiệu lực, trừ khoản đã tất toán dù trạng thái vẫn active", async () => {
    const metrics = await callKeyMetrics({
      app_code: "tikluy",
      from_date: vn("2026-11-01T00:00:00").toISOString(),
      to_date: vn("2026-11-13T23:59:59").toISOString()
    });
    expect(metrics.aum.value).toBe(100 * M);
    expect(metrics.active_investors.value).toBe(1);
  });

  test("cuối tháng 10 (trước khi B tất toán) vẫn tính B", async () => {
    const metrics = await callKeyMetrics({
      app_code: "tikluy",
      from_date: vn("2026-10-01T00:00:00").toISOString(),
      to_date: vn("2026-10-31T23:59:59").toISOString()
    });
    expect(metrics.aum.value).toBe(150 * M);
    expect(metrics.active_investors.value).toBe(2);
  });

  test("không lọc thời gian → số dư hiện tại", async () => {
    const metrics = await callKeyMetrics({ app_code: "tikluy" });
    expect(metrics.aum.value).toBe(100 * M);
  });
});
