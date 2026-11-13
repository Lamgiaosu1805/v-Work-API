import mongoose, { ClientSession } from "mongoose";
import AgentModel from "../models/AgentModel";
import DepartmentModel from "../models/DepartmentModel";
import UserDepartmentPositionModel from "../models/UserDepartmentPositionModel";

// Ghi nhận KPI bất biến cho khách (CIF) và khoản đầu tư — docs/CRM-DAILY-REPORT-FLOWS.md mục 4.
// Dùng ở các điểm gán Sale cũ (controllers/*.js) + script backfill. Chỉ đọc model, không ghi.

type Id = mongoose.Types.ObjectId | string;

export type KpiCifChannel = "sale_ref" | "claim" | "manual_confirmed" | "agent";
export type KpiInvestmentChannel = "sale" | "agent" | "unassigned";

export interface KpiCif {
  sale_id: Id | null;
  department_id: Id | null;
  agent_id: Id | null;
  channel: KpiCifChannel;
  at: Date;
}

export interface KpiInvestmentAttribution {
  sale_id: Id | null;
  department_id: Id | null;
  agent_id: Id | null;
  channel: KpiInvestmentChannel;
  attributed_at: Date;
}

// Loại phòng ban của TTKD (nhãn "Chi nhánh (TTKD)" trên HRM)
const SALES_UNIT_TYPE = "branch";

/**
 * TTKD hiện tại của từng Sale: phòng ban loại TTKD được xếp sớm nhất; Sale không thuộc TTKD nào thì lấy
 * phòng ban đầu tiên còn hoạt động; không có phòng ban → null.
 */
export async function resolveSaleUnitIds(
  saleIds: Id[],
  session?: ClientSession | null
): Promise<Map<string, mongoose.Types.ObjectId | null>> {
  const result = new Map<string, mongoose.Types.ObjectId | null>();
  const ids = [...new Set(saleIds.filter(Boolean).map(String))];
  if (!ids.length) return result;

  const memberships = (await UserDepartmentPositionModel.find({
    user: { $in: ids },
    isDeleted: false
  })
    .select("user department createdAt")
    .sort({ createdAt: 1 })
    .session(session ?? null)
    .lean()) as any[];
  const departments = (await DepartmentModel.find({
    _id: { $in: memberships.map((m) => m.department) },
    isDeleted: false
  })
    .select("type")
    .session(session ?? null)
    .lean()) as any[];
  const typeById = new Map(departments.map((d) => [String(d._id), d.type as string]));

  ids.forEach((saleId) => {
    const own = memberships.filter(
      (m) => String(m.user) === saleId && typeById.has(String(m.department))
    );
    const unit = own.find((m) => typeById.get(String(m.department)) === SALES_UNIT_TYPE) ?? own[0];
    result.set(saleId, unit ? (unit.department as mongoose.Types.ObjectId) : null);
  });
  return result;
}

export async function resolveSaleUnitId(
  saleId: Id | null | undefined,
  session?: ClientSession | null
): Promise<mongoose.Types.ObjectId | null> {
  if (!saleId) return null;
  const units = await resolveSaleUnitIds([saleId], session);
  return units.get(String(saleId)) ?? null;
}

/** Sale phụ trách đại lý/CTV (R4); đại lý chưa gán Sale → null. */
export async function resolveAgentSaleId(
  agentId: Id | null | undefined,
  session?: ClientSession | null
): Promise<mongoose.Types.ObjectId | null> {
  if (!agentId) return null;
  const agent = (await AgentModel.findById(agentId)
    .select("manager_sale_id")
    .session(session ?? null)
    .lean()) as any;
  return agent?.manager_sale_id ?? null;
}

/**
 * Bản ghi nhận CIF (R1). Kênh "agent" tự tra Sale phụ trách đại lý; các kênh còn lại dùng `saleId`.
 * TTKD chụp tại thời điểm gọi.
 */
export async function buildKpiCif(input: {
  channel: KpiCifChannel;
  at: Date;
  saleId?: Id | null;
  agentId?: Id | null;
  session?: ClientSession | null;
}): Promise<KpiCif> {
  const saleId =
    input.channel === "agent"
      ? await resolveAgentSaleId(input.agentId, input.session)
      : (input.saleId ?? null);
  return {
    sale_id: saleId,
    department_id: await resolveSaleUnitId(saleId, input.session),
    agent_id: input.agentId ?? null,
    channel: input.channel,
    at: input.at
  };
}

/**
 * Ghi nhận doanh số cho khoản đầu tư mới (R2): Sale đang giữ khách → Sale phụ trách đại lý của khách
 * → "Chưa phân bổ". Mọi kỳ hạn, không phụ thuộc hoa hồng.
 */
export async function buildInvestmentAttribution(
  customer: { referred_by?: Id | null; agent_id?: Id | null },
  session?: ClientSession | null,
  at: Date = new Date()
): Promise<KpiInvestmentAttribution> {
  const agentId = customer.agent_id ?? null;
  if (customer.referred_by) {
    return {
      sale_id: customer.referred_by,
      department_id: await resolveSaleUnitId(customer.referred_by, session),
      agent_id: agentId,
      channel: "sale",
      attributed_at: at
    };
  }
  const agentSaleId = await resolveAgentSaleId(agentId, session);
  if (agentSaleId) {
    return {
      sale_id: agentSaleId,
      department_id: await resolveSaleUnitId(agentSaleId, session),
      agent_id: agentId,
      channel: "agent",
      attributed_at: at
    };
  }
  return {
    sale_id: null,
    department_id: null,
    agent_id: agentId,
    channel: "unassigned",
    attributed_at: at
  };
}

/** CIF đang ghi nhận cho đúng Sale này (dùng khi bỏ gán / thu hồi yêu cầu nhận khách để huỷ ghi nhận). */
export function isKpiCifOf(
  kpiCif: { sale_id?: Id | null; channel?: string } | null | undefined,
  saleId: Id,
  channels?: KpiCifChannel[]
): boolean {
  if (!kpiCif?.sale_id || String(kpiCif.sale_id) !== String(saleId)) return false;
  return !channels || channels.includes(kpiCif.channel as KpiCifChannel);
}
