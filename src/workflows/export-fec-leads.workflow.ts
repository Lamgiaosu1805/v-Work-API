import * as XLSX from "xlsx";
import { Ability, toMongoQuery } from "../modules/permission";
import { exportFecLeadRows } from "../modules/fec-lead";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataExportLogModel = require("../models/DataExportLogModel");

export interface ExportFecLeadsInput {
  appCode: string;
  bucket?: string;
  q?: string;
  accountId: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

const COLUMN_WIDTHS = [6, 26, 15, 24, 20, 32, 55, 22, 10, 20, 20, 11, 16, 16];

// Xuất Excel khách FE Credit: cùng phạm vi quyền với danh sách và có ghi nhật ký xuất dữ liệu
// (Quy định 183A, Điều 11: tự ý xuất dữ liệu khách là hành vi gian lận) như xuất Excel khách hàng.
export async function exportFecLeadsForViewer(
  ability: Ability,
  input: ExportFecLeadsInput
): Promise<{ buffer: Buffer; filename: string }> {
  const rows = await exportFecLeadRows({
    appCode: input.appCode,
    bucket: input.bucket,
    q: input.q,
    customerScope: toMongoQuery(ability, "customer.view", "Customer")
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Khách FE Credit");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await DataExportLogModel.create({
    account_id: input.accountId,
    resource: "fec_lead",
    filters: { app_code: input.appCode, bucket: input.bucket ?? null, q: input.q ?? null },
    row_count: rows.length,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null
  });

  return { buffer, filename: `khach_fe_credit_${new Date().toISOString().slice(0, 10)}.xlsx` };
}
