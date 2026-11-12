import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import AppModel from "../src/models/AppModel";
import KpiPlanModel from "../src/models/KpiPlanModel";
import UserInfoModel from "../src/models/UserInfoModel";
import {
  KPI_TEMPLATES,
  KpiTemplateCode,
  parseDateKey,
  plannableMetrics
} from "../src/modules/daily-report";

// Nạp kế hoạch KPI năm (Quyết định giao chỉ tiêu) cho Sale — có kế hoạch = phải nộp báo cáo ngày từ effective_from.
// File JSON: xem scripts/data/daily-report-kpi-plans.example.json. Số tiền tính bằng ĐỒNG.
// Upsert theo (app, năm, mã NV) — chạy lại để sửa KH. Chạy thử: --dry-run.
// Chạy: npx ts-node --transpile-only scripts/seedDailyReportKpiPlans.ts --file=<đường dẫn json> [--app=tikluy] [--dry-run]

interface PlanInput {
  ma_nv: string;
  template: string;
  effective_from: string;
  decision_ref?: string;
  note?: string;
  targets: Record<string, number | { annual: number; monthly?: number[] }>;
}

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const FILE = arg("file");
const APP_CODE = arg("app") ?? "tikluy";
const DRY_RUN = args.includes("--dry-run");

function parseTargets(input: PlanInput) {
  const template = input.template as KpiTemplateCode;
  const allowed = plannableMetrics(template);
  return Object.entries(input.targets).map(([metric, raw]) => {
    if (!allowed.includes(metric as never)) {
      throw new Error(
        `${input.ma_nv}: chỉ tiêu "${metric}" không thuộc bộ ${template} (cho phép: ${allowed.join(", ")})`
      );
    }
    const annual = typeof raw === "number" ? raw : raw.annual;
    const monthly = typeof raw === "number" ? [] : (raw.monthly ?? []);
    if (!(annual >= 0)) throw new Error(`${input.ma_nv}: KH năm của "${metric}" không hợp lệ`);
    if (monthly.length && monthly.length !== 12) {
      throw new Error(`${input.ma_nv}: phân bổ tháng của "${metric}" phải đủ 12 tháng`);
    }
    return { metric_code: metric, annual, monthly };
  });
}

async function main(): Promise<void> {
  if (!FILE) throw new Error("Thiếu --file=<đường dẫn json>");
  const config = JSON.parse(fs.readFileSync(path.resolve(FILE), "utf8")) as {
    year: number;
    plans: PlanInput[];
  };
  if (!Number.isInteger(config.year)) throw new Error("File thiếu year");

  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log(`✅ Kết nối MongoDB thành công${DRY_RUN ? " — CHẠY THỬ, không ghi" : ""}\n`);

  const app = (await AppModel.findOne({ code: APP_CODE }).select("_id").lean()) as any;
  if (!app) throw new Error(`Không tìm thấy app "${APP_CODE}"`);

  let saved = 0;
  for (const plan of config.plans) {
    if (!(plan.template in KPI_TEMPLATES)) {
      throw new Error(`${plan.ma_nv}: bộ KPI "${plan.template}" không hợp lệ (TTKD | PRIORITY)`);
    }
    const effectiveFrom = parseDateKey(plan.effective_from);
    const targets = parseTargets(plan);
    const employee = (await UserInfoModel.findOne({ ma_nv: plan.ma_nv, isDeleted: false })
      .select("_id full_name")
      .lean()) as any;
    if (!employee) {
      console.log(`⚠️  Bỏ qua ${plan.ma_nv}: không tìm thấy nhân viên`);
      continue;
    }

    console.log(
      `${DRY_RUN ? "🔎" : "✅"} ${plan.ma_nv} ${employee.full_name} — ${plan.template}, từ ${effectiveFrom}, ${targets
        .map((t) => `${t.metric_code}=${t.annual.toLocaleString("vi-VN")}`)
        .join(", ")}`
    );
    if (DRY_RUN) continue;

    await KpiPlanModel.updateOne(
      { app_id: app._id, year: config.year, employee_id: employee._id, isDeleted: false },
      {
        $set: {
          template_code: plan.template,
          effective_from: effectiveFrom,
          targets,
          decision_ref: plan.decision_ref ?? null,
          note: plan.note ?? null
        }
      },
      { upsert: true }
    );
    saved += 1;
  }

  await mongoose.disconnect();
  console.log(
    `\n🎉 Xong: ${DRY_RUN ? "chạy thử" : `ghi ${saved} kế hoạch`} / ${config.plans.length} dòng`
  );
}

main().catch((err) => {
  console.error("❌ Lỗi:", err.message ?? err);
  process.exit(1);
});
