import moment from "moment-timezone";

// Ánh xạ 1 dòng danh mục đầu tư TIKLUY → bản ghi tất toán của vWork (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3).
// Đối chiếu dữ liệu live 13/11/2026: `id` (UUID) = external_investment_id của vWork, `investmentCode` chỉ là mã hiển thị
// (VNF…); ngày dạng "HH:mm DD/MM/YYYY"; tái tục ghi "Chuyển gốc và lãi sang kỳ hạn mới", khoản mới = gốc + lãi.
// Tất toán trước hạn không có ngày tất toán thật — endDate là ngày đáo hạn theo hợp đồng.

const TZ = "Asia/Ho_Chi_Minh";
const DATE_FORMATS = [
  "HH:mm DD/MM/YYYY",
  "HH:mm:ss DD/MM/YYYY",
  "DD/MM/YYYY HH:mm:ss",
  "DD/MM/YYYY HH:mm",
  "DD/MM/YYYY",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYY-MM-DD"
];
const DAY_MS = 24 * 60 * 60 * 1000;
// Khoản mới coi là tái tục nếu bắt đầu trong ±2 ngày quanh ngày tất toán và gốc ≥ 99% gốc cũ
const RENEWAL_WINDOW_MS = 2 * DAY_MS;
const RENEWAL_MIN_RATIO = 0.99;

export const HOLDING_STATUS = { ACTIVE: 0, EARLY_TERMINATED: 1, MATURED: 2 } as const;

export interface HoldingRow {
  id?: string | null;
  investmentCode?: string | number | null;
  investAmount?: number | string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: number | string | null;
  totalProfit?: number | string | null;
  formOfMaturity?: string | null;
}

export interface ClosureRecord {
  type: "matured" | "early_terminated";
  closed_at: Date;
  principal: number;
  profit: number;
  form_of_maturity: string | null;
  renewed: boolean;
  synced_at: Date;
}

/** Ngày TIKLUY: chấp nhận ISO và các dạng dd/MM/yyyy, yyyy-MM-dd (giờ VN). */
export function parseTikluyDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const iso = moment(text, moment.ISO_8601, true);
    return iso.isValid() ? iso.toDate() : null;
  }
  const parsed = moment.tz(text, DATE_FORMATS, true, TZ);
  return parsed.isValid() ? parsed.toDate() : null;
}

const unaccent = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Mã để khớp với external_investment_id: `id` của TIKLUY, dữ liệu cũ thiếu `id` thì thử `investmentCode`. */
export function holdingKeys(row: HoldingRow): string[] {
  return [row.id, row.investmentCode]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(String);
}

/**
 * Hình thức đáo hạn có chuyển gốc sang kỳ mới: "Chuyển gốc và lãi sang kỳ hạn mới", "Chuyển gốc sang kỳ hạn mới",
 * "Tái tục gốc"…, trừ dạng phủ định "không tái tục". "Nhận lãi và gốc cuối kỳ" là rút.
 */
export function isRenewalForm(form: unknown): boolean {
  if (typeof form !== "string") return false;
  const text = unaccent(form);
  if (text.includes("khong tai tuc")) return false;
  return text.includes("tai tuc") || text.includes("sang ky han moi");
}

/**
 * Dòng đã tất toán → bản ghi tất toán; dòng đang đầu tư / thiếu dữ liệu → null.
 * Tất toán trước hạn mà ngày kết thúc chưa tới (TIKLUY trả ngày đáo hạn theo hợp đồng) → lấy thời điểm phát hiện.
 */
export function mapHoldingClosure(row: HoldingRow, now: Date): ClosureRecord | null {
  const status = Number(row.status);
  if (status !== HOLDING_STATUS.EARLY_TERMINATED && status !== HOLDING_STATUS.MATURED) return null;
  const principal = Number(row.investAmount);
  if (!(principal > 0)) return null;

  let closedAt = parseTikluyDate(row.endDate);
  if (status === HOLDING_STATUS.EARLY_TERMINATED && (!closedAt || closedAt > now)) closedAt = now;
  if (!closedAt || closedAt.getTime() > now.getTime() + DAY_MS) return null;

  return {
    type: status === HOLDING_STATUS.EARLY_TERMINATED ? "early_terminated" : "matured",
    closed_at: closedAt,
    principal,
    profit: Number(row.totalProfit) || 0,
    form_of_maturity: row.formOfMaturity ?? null,
    renewed: status === HOLDING_STATUS.MATURED && isRenewalForm(row.formOfMaturity),
    synced_at: now
  };
}

interface RenewalCandidate {
  _id: unknown;
  amount: number;
  invested_at: Date;
}

/**
 * Khoản mới của cùng khách sinh ra do tái tục khoản vừa đáo hạn, không có → null. Nhiều khoản đáo hạn cùng lúc
 * (vd 1 triệu và 2 triệu cùng ngày) → chọn khoản có số tiền sát gốc nhất (gốc + lãi), rồi gần thời điểm nhất.
 */
export function findRenewalTarget<T extends RenewalCandidate>(
  closure: ClosureRecord,
  candidates: T[]
): T | null {
  if (closure.type !== "matured") return null;
  const closedMs = closure.closed_at.getTime();
  const gap = (c: T) => Math.abs(new Date(c.invested_at).getTime() - closedMs);
  const matches = candidates.filter(
    (c) => gap(c) <= RENEWAL_WINDOW_MS && c.amount >= closure.principal * RENEWAL_MIN_RATIO
  );
  matches.sort((a, b) => a.amount - b.amount || gap(a) - gap(b));
  return matches[0] ?? null;
}
