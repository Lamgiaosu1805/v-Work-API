import AppModel from "../../../models/AppModel";
import CustomerModel from "../../../models/CustomerModel";
import { CrmCustomerRef, TicketCustomerResolver } from "../application/ports";

// SĐT về dạng 0xxxxxxxxx ("+84 343 316 951", "84343316951" → "0343316951"), cùng quy tắc với frontend.
export function toLocalPhone(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
}

// CRM nhận SĐT từ hệ thống ngoài nên có thể lưu ở vài dạng; tra đúng các dạng thường gặp (dùng được index) thay vì regex.
function phoneVariants(phone: string): string[] {
  const local = toLocalPhone(phone);
  if (local.length < 9 || !local.startsWith("0")) return [];
  const rest = local.slice(1);
  return [local, `84${rest}`, `+84${rest}`];
}

export class MongooseTicketCustomerResolver implements TicketCustomerResolver {
  // eslint-disable-next-line class-methods-use-this
  async findByPhone(phone: string, appCode: string): Promise<CrmCustomerRef | null> {
    const variants = phoneVariants(phone);
    if (!variants.length || !appCode) return null;

    const code = appCode.toLowerCase();
    const app = (await AppModel.findOne({ code, isDeleted: false })
      .select("_id")
      .lean()) as { _id: unknown } | null;
    if (!app) return null;

    // Mỗi app chỉ có một khách cho mỗi SĐT; lấy tối đa 2 để phát hiện trường hợp mơ hồ (nhiều dạng SĐT cùng tồn tại).
    const matches = (await CustomerModel.find({
      app_id: app._id,
      phone_number: { $in: variants },
      isDeleted: false
    })
      .select("_id external_id")
      .limit(2)
      .lean()) as Array<{ _id: unknown; external_id?: string | null }>;
    if (matches.length !== 1) return null;

    return {
      customerId: String(matches[0]._id),
      externalId: matches[0].external_id ? String(matches[0].external_id) : null,
      appCode: code
    };
  }
}
