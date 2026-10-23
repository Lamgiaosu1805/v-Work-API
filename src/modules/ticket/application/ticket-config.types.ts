import { TicketUrgency } from "../domain/types";

// Dạng đọc của dữ liệu cấu hình (sản phẩm / loại yêu cầu / mẫu yêu cầu).

export interface ProductDef {
  id: string;
  code: string;
  name: string;
  group: string;
  appCode: string | null;
  description: string;
  isActive: boolean;
  sortOrder: number;
}

export interface CategoryDef {
  id: string;
  code: string;
  name: string;
  description: string;
  handlerIds: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface TemplateFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "phone" | "number" | "money" | "date" | "select";
  required: boolean;
  placeholder: string;
  help: string;
  options: string[];
}

export interface TemplateDocumentDef {
  kind: string;
  label: string;
  required: boolean;
  sensitive: boolean;
}

export interface TemplateDef {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  titlePattern: string;
  fields: TemplateFieldDef[];
  requiredDocuments: TemplateDocumentDef[];
  requiresApproval: boolean;
  defaultUrgency: TicketUrgency;
  handlerIds: string[];
  guidance: string;
  isActive: boolean;
  sortOrder: number;
}

export interface TicketConfigReader {
  findProduct(id: string): Promise<ProductDef | null>;
  findCategory(id: string): Promise<CategoryDef | null>;
  findTemplate(id: string): Promise<TemplateDef | null>;
  listProducts(activeOnly: boolean): Promise<ProductDef[]>;
  listCategories(activeOnly: boolean): Promise<CategoryDef[]>;
  listTemplates(activeOnly: boolean): Promise<TemplateDef[]>;
}
