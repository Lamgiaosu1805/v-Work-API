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
    isActive: doc.is_active !== false,
    sortOrder: doc.sort_order ?? 0
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
    sortOrder: doc.sort_order ?? 0
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
      options: field.options ?? []
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
    sortOrder: doc.sort_order ?? 0
  };
}

const bySortOrder = (
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string }
) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi");

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
    return (await TicketProductModel.find(filter).lean()).map(toProductDef).sort(bySortOrder);
  }

  // eslint-disable-next-line class-methods-use-this
  async listCategories(activeOnly: boolean) {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (activeOnly) filter.is_active = true;
    return (await TicketCategoryModel.find(filter).lean()).map(toCategoryDef).sort(bySortOrder);
  }

  // eslint-disable-next-line class-methods-use-this
  async listTemplates(activeOnly: boolean) {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (activeOnly) filter.is_active = true;
    return (await TicketTemplateModel.find(filter).lean()).map(toTemplateDef).sort(bySortOrder);
  }
}
