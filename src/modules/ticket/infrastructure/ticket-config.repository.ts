import TicketCategoryModel from "../../../models/TicketCategoryModel";
import TicketProductModel from "../../../models/TicketProductModel";
import TicketTemplateModel from "../../../models/TicketTemplateModel";
import {
  CategoryDef,
  ProductDef,
  TemplateDef,
  TicketConfigReader
} from "../application/ticket-config.types";

const ids = (values: unknown): string[] => ((values as unknown[]) ?? []).map(String);

export function toProductDef(doc: any): ProductDef {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    group: doc.group ?? "",
    appCode: doc.app_code ?? null,
    description: doc.description ?? "",
    handlerIds: ids(doc.handler_ids),
    isActive: doc.is_active !== false,
    sortOrder: typeof doc.sort_order === "number" ? doc.sort_order : null,
    createdAt: doc.createdAt ?? new Date(0)
  };
}

export function toCategoryDef(doc: any): CategoryDef {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    description: doc.description ?? "",
    handlerIds: ids(doc.handler_ids),
    isActive: doc.is_active !== false,
    createdAt: doc.createdAt ?? new Date(0)
  };
}

export function toTemplateDef(doc: any): TemplateDef {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    categoryId: String(doc.category_id),
    titlePattern: doc.title_pattern ?? "",
    fields: (doc.fields ?? []).map((field: any) => ({
      key: field.key,
      label: field.label,
      type: field.type ?? "text",
      required: Boolean(field.required),
      placeholder: field.placeholder ?? "",
      help: field.help ?? "",
      options: field.options ?? [],
      appCodes: field.app_codes ?? []
    })),
    requiredDocuments: (doc.required_documents ?? []).map((item: any) => ({
      kind: item.kind,
      label: item.label,
      required: Boolean(item.required),
      sensitive: Boolean(item.sensitive)
    })),
    requiresApproval: Boolean(doc.requires_approval),
    defaultUrgency: doc.default_urgency ?? "normal",
    handlerIds: ids(doc.handler_ids),
    guidance: doc.guidance ?? "",
    isActive: doc.is_active !== false,
    createdAt: doc.createdAt ?? new Date(0)
  };
}

// Thứ tự hiển thị danh mục cấu hình (không còn trường "thứ tự" nhập tay): theo NGÀY TẠO, cũ trước.
const timeOf = (item: { createdAt: Date }) => new Date(item.createdAt).getTime();
const byCreated = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
  timeOf(a) - timeOf(b) || a.id.localeCompare(b.id);

export const sortCategories = (categories: CategoryDef[]) => [...categories].sort(byCreated);

// Sản phẩm luôn nhóm theo "Nhóm" (VNFITE, TIKLUY, vWork...) — cùng nhóm đứng liền nhau.
// Thứ tự gốc của một sản phẩm: `sortOrder` do người quản trị kéo thả (tăng dần); chưa có thì xếp sau, theo ngày tạo.
// Nhóm đứng theo sản phẩm đứng đầu của nhóm; trong nhóm xếp theo thứ tự gốc.
// (Infinity - Infinity = NaN là falsy nên hai sản phẩm cùng chưa có thứ tự sẽ so ngày tạo.)
const compareProducts = (a: ProductDef, b: ProductDef) =>
  (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || byCreated(a, b);

export function sortProducts(products: ProductDef[]): ProductDef[] {
  const groupKey = (product: ProductDef) => product.group || "";
  const leader = new Map<string, ProductDef>();
  products.forEach((product) => {
    const key = groupKey(product);
    const current = leader.get(key);
    if (!current || compareProducts(product, current) < 0) leader.set(key, product);
  });
  return [...products].sort(
    (a, b) =>
      compareProducts(
        leader.get(groupKey(a)) as ProductDef,
        leader.get(groupKey(b)) as ProductDef
      ) ||
      groupKey(a).localeCompare(groupKey(b), "vi") ||
      compareProducts(a, b)
  );
}

// Mẫu yêu cầu nhóm theo loại yêu cầu (loại xếp theo ngày tạo), trong loại xếp theo ngày tạo của mẫu.
export function sortTemplates(templates: TemplateDef[], categories: CategoryDef[]): TemplateDef[] {
  const categoryRank = new Map(
    sortCategories(categories).map((category, index) => [category.id, index])
  );
  const rankOf = (template: TemplateDef) => categoryRank.get(template.categoryId) ?? Infinity;
  return [...templates].sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    return Number.isNaN(rank) ? byCreated(a, b) : rank || byCreated(a, b);
  });
}

export class MongooseTicketConfigReader implements TicketConfigReader {
  // eslint-disable-next-line class-methods-use-this
  async findProduct(id: string) {
    const doc = await TicketProductModel.findOne({ _id: id, isDeleted: false }).lean();
    return doc ? toProductDef(doc) : null;
  }

  // eslint-disable-next-line class-methods-use-this
  async findCategory(id: string) {
    const doc = await TicketCategoryModel.findOne({ _id: id, isDeleted: false }).lean();
    return doc ? toCategoryDef(doc) : null;
  }

  // eslint-disable-next-line class-methods-use-this
  async findTemplate(id: string) {
    const doc = await TicketTemplateModel.findOne({ _id: id, isDeleted: false }).lean();
    return doc ? toTemplateDef(doc) : null;
  }

  // eslint-disable-next-line class-methods-use-this
  async listProducts(activeOnly: boolean) {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (activeOnly) filter.is_active = true;
    return sortProducts((await TicketProductModel.find(filter).lean()).map(toProductDef));
  }

  // eslint-disable-next-line class-methods-use-this
  async listCategories(activeOnly: boolean) {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (activeOnly) filter.is_active = true;
    return sortCategories((await TicketCategoryModel.find(filter).lean()).map(toCategoryDef));
  }

  // eslint-disable-next-line class-methods-use-this
  async listTemplates(activeOnly: boolean) {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (activeOnly) filter.is_active = true;
    const [templates, categories] = await Promise.all([
      TicketTemplateModel.find(filter).lean(),
      TicketCategoryModel.find({ isDeleted: false }).lean()
    ]);
    return sortTemplates(templates.map(toTemplateDef), categories.map(toCategoryDef));
  }
}
